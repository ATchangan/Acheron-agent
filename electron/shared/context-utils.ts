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
