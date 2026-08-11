// electron/engine/sub-result.ts — 子代理提示词与结果结构化(纯函数, 可单测)
import type { AgentDef } from './agents'

export interface SubResult {
  goal?: string
  status?: string
  outputs?: string[]
  open?: string[]
  note?: string
}

// 子代理系统提示: 角色 + 任务要求 + 私有记忆(可选) + 交付 JSON 硬性约束
export function buildSubSystemPrompt(ag: AgentDef, agentName: string, task: string, memoryText: string): string {
  const mem = memoryText ? '\n\n## 私有记忆\n' + memoryText : ''
  return '## 当前身份\n' + ag.icon + ' ' + agentName + ' — ' + ag.role + '\n' + ag.prompt +
    '\n（你是本次分发的一个子任务执行者，直接完成分配给你的子任务并输出成果。你可以调用工具（文件读写/命令执行/网络检索等）来真正完成工作。' +
    '不要询问。' + mem +
    '\n\n## 交付格式（硬性约束）\n完成工作后，最后输出一段 JSON（放在行首 ```json 与行尾 ``` 之间），字段：' +
    '{"goal":"任务目标","status":"done|partial|failed","outputs":["产出物1(文件路径或结论)"],"open":["未决问题(没有则为[])"],"note":"一句话说明"}。' +
    'JSON 之前可以有一两句简要说明。'
}

// 从子代理结果中提取结构化字段: 优先 ```json 代码块, 兜底取最后一个 JSON 对象
export function parseSubResult(text: string): SubResult {
  const t = String(text || '')
  const block = t.match(/```json\s*([\s\S]*?)```/i) || t.match(/\{[\s\S]*\}/)
  if (!block) return {}
  try {
    const obj = JSON.parse(block[1] ?? block[0]) as Record<string, unknown>
    const out: SubResult = {}
    if (typeof obj.goal === 'string') out.goal = obj.goal
    if (typeof obj.status === 'string') out.status = obj.status
    if (typeof obj.note === 'string') out.note = obj.note
    if (Array.isArray(obj.outputs)) out.outputs = obj.outputs.map(String)
    if (Array.isArray(obj.open)) out.open = obj.open.map(String)
    return out
  } catch { return {} }
}

// 汇总结果: 有结构化字段时输出结构化摘要, 否则回退原文
export function buildSubSummary(agentName: string, task: string, parsed: SubResult, raw?: string): string {
  const p = parsed || {}
  if (!p.goal && !p.status && !p.outputs?.length && !p.open?.length && !p.note) {
    return raw || ('【' + agentName + '】' + String(task || ''))
  }
  const lines = ['【' + agentName + '】任务完成']
  if (p.goal) lines.push('目标: ' + String(p.goal).slice(0, 200))
  if (p.status) lines.push('状态: ' + String(p.status))
  if (p.outputs?.length) lines.push('产出物:\n' + p.outputs.map((x, i) => '  ' + (i + 1) + '. ' + x).join('\n'))
  if (p.open?.length) lines.push('未决问题:\n' + p.open.map((x, i) => '  ' + (i + 1) + '. ' + x).join('\n'))
  if (p.note) lines.push('说明: ' + String(p.note))
  return lines.join('\n')
}
