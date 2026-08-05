// src/store/context-utils.ts —— 上下文纯函数工具(token 估算/校准/模型窗口/输出分级)
// 从 context.ts 拆出(单文件上限红线), context.ts re-export 保持调用方兼容
import { useChatStore } from './chat'
import type { Message } from '../global'
import type { GeneralSettings } from '../types'
import { VISION_MODEL_HINTS } from './constants'

// v0.3.4 T1: 按模型隔离的实测校准系数(初始 1.0, EMA 平滑, 限幅 0.3~3 防单次异常拉偏)
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
function getScale(): number {
  const m = useChatStore.getState().curModel || ''
  return scaleByModel.get(m) ?? 1.0
}

// v0.3.4 T1: 分层估算 —— 代码块(/3.5) + 中文(×1.2) + URL(段级) + 剩余(/4), 最后乘实测校准系数
export function estimateTokens(text: string): number {
  if (!text) return 0
  const s = getScale()
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

// v0.3.2 T7: 输出上限分级(纯函数, 只降明确闲聊场景; 代码/文件/任务类保持全局上限, 杜绝截断风险)
export function outputLimit(userMsg: string, cfg: GeneralSettings): number | undefined {
  const base = cfg.maxTokens || 4096
  if (userMsg.length < 40 && !/(代码|文件|报告|项目|脚本|写|改|建|查|找|分析)/.test(userMsg)) {
    return Math.min(base, 800)
  }
  return base
}

// v0.3.2 T8: 会话累计 token 统计 —— 从消息 usage 重算(不新增存储; 兼容 input/output 两种命名)
export function sessionTokens(msgs: Message[]): { input: number; output: number } {
  let input = 0, output = 0
  for (const m of msgs) {
    const u = m.usage
    if (!u) continue
    input += u.input_tokens || u.prompt_tokens || 0
    output += (u as { output_tokens?: number }).output_tokens || u.completion_tokens || 0
  }
  return { input, output }
}

function getModelContextLimit(modelName: string): number {
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
function updateContextLimit(modelName: string) {
  const limit = getModelContextLimit(modelName)
  const s = useChatStore.getState()
  if (s.cl !== limit) useChatStore.setState({ cl: limit })
}
// 导出供外部调用（模型切换时实时更新）
export { updateContextLimit, getModelContextLimit }

export function isVisionModel(m: string): boolean {
  const ml = (m || '').toLowerCase()
  return VISION_MODEL_HINTS.some(v => ml.includes(v))
}
