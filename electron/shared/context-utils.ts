// electron/shared/context-utils.ts —— renderer/main 共享纯函数（B5）
// 约束：本文件禁止 import electron API / zustand / fs，必须保持纯函数
import { VISION_MODEL_HINTS } from './constants'

export function slimToolResult(c: string, head = 800, tail = 500): string {
  if (c.length <= 1500) return c
  const mid = c.slice(head, -tail)
  const keyLines = mid.split('\n').filter((l: string) => /error|exception|failed|warning|fatal|E:/.test(l)).slice(0, 15).join('\n')
  return c.slice(0, head) + '\n...[已截断, 共 ' + c.length + ' 字符]' + (keyLines ? '\n[关键行]\n' + keyLines : '') + '\n[尾部]\n' + c.slice(-tail)
}

const ARG_KEEP = new Set(['path', 'name', 'dirPath', 'glob', 'pattern', 'query', 'url', 'pid', 'id', 'agent', 'agent_name', 'expression', 'tool', 'key', 'fileId', 'workflow_id', 'server', 'offset', 'limit', 'lang', 'mode'])
const ARG_SLIM_LEN = 200
function slimArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(args || {})) {
    if (typeof v === 'string' && v.length > ARG_SLIM_LEN && !ARG_KEEP.has(k)) {
      out[k] = v.slice(0, ARG_SLIM_LEN) + '…[省略' + (v.length - ARG_SLIM_LEN) + '字]'
    } else if (Array.isArray(v) && v.length > 20 && v.every(x => typeof x === 'string')) {
      out[k] = v.slice(0, 20) + '…[省略' + (v.length - 20) + '项]'
    } else out[k] = v
  }
  return out
}

export function slimToolCallArgs(tc: { id?: string; type: string; function: { name: string; arguments: string } }): { id?: string; type: string; function: { name: string; arguments: string } } {
  try {
    const parsed = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
    return { ...tc, function: { ...tc.function, arguments: JSON.stringify(slimArgs(parsed)) } }
  } catch { return tc }
}

export interface TaskArchive { goal: string; conclusion: string; outputs: string[]; tools: string; ts: number }

export function buildTaskArchives<T extends { role: string; content?: unknown; tool_calls?: { function?: { name?: string; arguments?: string } }[] }>(msgs: T[]): { keep: T[]; archives: TaskArchive[] } {
  const blocks: T[][] = []
  let cur: T[] = []
  for (const m of msgs) {
    if (m.role === 'user') { if (cur.length) blocks.push(cur); cur = [m] }
    else cur.push(m)
  }
  if (cur.length) blocks.push(cur)
  const archives: TaskArchive[] = []
  let keep = msgs
  let blockIdx = 0
  // 归档条件(缺一不可): 最早块 ≥6 消息 且 ≥2 次工具调用 且存在 ≥2 个任务块
  while (blocks.length - blockIdx >= 2) {
    const b = blocks[blockIdx]
    if (b.length < 6 || b.filter(m => m.role === 'tool').length < 2) break
    const goal = String(b.find(m => m.role === 'user')?.content || '').slice(0, 80)
    const lastAsst = [...b].reverse().find(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 50)
    const conclusion = lastAsst ? String(lastAsst.content).replace(/\n/g, ' ').slice(0, 100) : ''
    const outputs = [...new Set(
      b
        .filter(m => m.role === 'assistant' && m.tool_calls)
        .flatMap(m => (m.tool_calls || []).map(tc => { try { return (JSON.parse(tc.function?.arguments || '{}') as { path?: unknown }).path } catch { return undefined } }))
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
    )].slice(0, 5)
    const toolAgg = new Map<string, number>()
    for (const m of b) if (m.role === 'assistant' && m.tool_calls) for (const tc of m.tool_calls) {
      const tname = tc.function?.name || '?'
      toolAgg.set(tname, (toolAgg.get(tname) || 0) + 1)
    }
    const tools = [...toolAgg.entries()].slice(0, 8).map(([n, c]) => `${n}(${c})`).join(' ')
    archives.push({ goal, conclusion, outputs, tools, ts: Date.now() })
    blockIdx++
    keep = blocks[blockIdx] ? msgs.slice(msgs.indexOf(blocks[blockIdx][0])) : msgs.slice(msgs.length)
  }
  return { keep, archives }
}

// ─── token 实测校准（模块级 EMA 状态，renderer/main 共享同一份） ───
const scaleByModel = new Map<string, number>()
export function calibrateTokens(model: string, actual: number, estimated: number): void {
  if (!model || !actual || !estimated) return
  const cur = scaleByModel.get(model) ?? 1.0
  const ratio = Math.min(3, Math.max(0.3, actual / estimated))
  scaleByModel.set(model, cur * 0.8 + ratio * 0.2)
}
export function getCalibrationScale(model: string): number {
  return scaleByModel.get(model) ?? 1.0
}

export function isVisionModel(m: string): boolean {
  const ml = (m || '').toLowerCase()
  return VISION_MODEL_HINTS.some(v => ml.includes(v))
}

// ── token 估算 / 输出分级 / 上下文窗口（B6-2：renderer/main 共用同一份实现） ──
export function estimateTokens(text: string, model?: string): number {
  const s = getCalibrationScale(model || '')
  if (!text) return 0
  let base = 0
  const codeBlocks = text.match(/```[\s\S]*?```/g) || []
  for (const b of codeBlocks) base += b.length / 3.5
  const rest = text.replace(/```[\s\S]*?```/g, '')
  const cn = (rest.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  base += cn * 1.2
  const urlM = rest.match(/[a-z]+:\/\/[^\s"'<>]+/gi) || []
  for (const u of urlM) base += 2 + u.split(/[\/?#]/).length
  const nonCn = rest.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, '').replace(/[a-z]+:\/\/[^\s"'<>]+/gi, '')
  base += nonCn.length / 4
  return Math.max(1, Math.round(base * s))
}

export function outputLimit(userMsg: string, cfg: { maxTokens?: number | string; perf?: { outputCap?: boolean } }): number | undefined {
  const base = Number(cfg.maxTokens) || 4096
  // v0.3.5 T2: 输出上限分级开关 —— 关闭时恒用全局上限
  if (cfg.perf?.outputCap === false) return base
  if (userMsg.length < 40 && !/(代码|文件|报告|项目|脚本|写|改|建|查|找|分析)/.test(userMsg)) {
    return Math.min(base, 800)
  }
  return base
}

export function getModelContextLimit(modelName: string): number {
  const m = modelName.toLowerCase()
  // 百万级
  if (m.includes('deepseek-v4') || m.includes('deepseek-chat') || m.includes('deepseek-reasoner')) return 1048576
  if (m.includes('gpt-4.1')) return 1048576
  if (m.includes('gemini-2.5') || m.includes('gemini-2') || m.includes('gemini-1.5')) return 1048576
  // 20万级
  if (m.includes('o3') || m.includes('o4') || m.includes('o1')) return 200000
  if (m.includes('claude-4') || m.includes('claude-3.5') || m.includes('claude-3') || m.includes('claude-2')) return 200000
  if (m.includes('yi-')) return 200000
  // 26万
  if (m.includes('qwen3')) return 262144
  if (m.includes('minimax')) return 245760
  // 13万
  if (m.includes('deepseek-v3')) return 131072
  if (m.includes('gpt-4o')) return 131072
  if (m.includes('gpt-4-turbo')) return 131072
  if (m.includes('qwen2.5') || m.includes('qwen')) return 131072
  if (m.includes('glm-4') || m.includes('glm')) return 131072
  if (m.includes('ernie-4.5')) return 131072
  if (m.includes('moonshot') || m.includes('kimi')) return 131072
  if (m.includes('doubao') || m.includes('skylark')) return 131072
  // 其他
  if (m.includes('gpt-4-32k')) return 32768
  if (m.includes('gpt-4')) return 8192
  if (m.includes('gpt-3.5-turbo-16k')) return 16384
  if (m.includes('gpt-3.5')) return 4096
  if (m.includes('deepseek')) return 65536
  if (m.includes('gemini')) return 32768
  if (m.includes('ernie')) return 8192
  // 默认 64K
  return 65536
}
