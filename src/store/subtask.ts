// src/store/subtask.ts —— dispatch 子任务并行执行(v0.3.0 M2)
// 职责: 子任务并行(subRounds 循环)/结果汇总。runDispatch 迁移自 chat.ts runTool 的 dispatch case(行为未改)
// 注意: 依赖 chat.ts 的 useChatStore(运行时循环依赖, 函数体内延迟解析, 安全)
import { useAgents } from './agents'
import { TOOLS } from './tools'
import { buildPrompt } from './context'
import { useChatStore } from './chat'
import { SUB_ROUND_LIMIT } from './constants'
import type { ProviderConfig, ToolCallDelta, ChunkData, SettingsData, LLMMessage } from '../global'
import type { ToolSpec } from '../types'
import { errMsg } from '../utils/safe'

export async function runDispatch(
  tasks: { agent: string; task: string }[],
  snapCfg: SettingsData | undefined,
  getTaskGen: () => number,
  runToolFn: (name: string, args: Record<string, unknown>, cfg: SettingsData | undefined) => Promise<string>
): Promise<string> {
        const agents = useAgents()
        if (!tasks.length) return 'E:dispatch 需要 tasks 数组 [{agent, task}]，例如 {"tasks":[{"agent":"螺丝咕姆","task":"..."},{"agent":"三月七","task":"..."}]}'
        const mode = snapCfg?.general?.mode || 'work'
        const ishiki = useChatStore.getState().sp ? useChatStore.getState().sp.replace(/\n##.+/s, '') : ''
        // 任务快照优先 —— 用户任务中改设置不影响本次分发
        const cfg = snapCfg || await window.huangquan.settings.load()
        // 已配置供应商优先(原 providers[0] 可能无 key, 分发失败)
        const p = cfg.providers.find((x: ProviderConfig) => x.apiKey && x.baseUrl) || cfg.providers[0]; if (!p) return 'E:未配置 Provider，无法分发'
        const model = p.selectedModel || p.models[0] || ''
        const out: string[] = []
        // 分发开始：所有子 Agent 一并显示（并发协作）
        const validAgents = tasks.map(t => t.agent).filter(n => agents[n])
        useChatStore.setState(s => ({ activeAgents: [...new Set([...s.activeAgents, ...validAgents])] }))
        // 并行执行子任务（每个子 Agent 独立系统提示词 + 真实工具调用循环 —— 子 Agent 也能调用工具真正干活）
        const dispStartGen = getTaskGen()
        const results = await Promise.all(tasks.map(async (t) => {
          const ag = agents[t.agent]
          if (!ag) return { agent: t.agent, task: t.task, error: 'unknown agent' }
          // v0.3.0 M3: 上下文隔离 —— 子 Agent 只含身份+任务, 不拼接全局历史/记忆/工具列表
          const sp = '## 当前身份\n' + ag.icon + ' ' + t.agent + ' — ' + ag.role + '\n' + ag.prompt + '\n（你是本次分发的一个子任务执行者，直接完成分配给你的子任务并输出成果。你可以调用工具（文件读写/命令执行/网络检索等）来真正完成工作，完成后给出结果摘要。不要询问。）'
          // 子 Agent 不嵌套协作工具(防递归 dispatch/handoff)
          const COLLAB_TOOLS = ['handoff', 'dispatch', 'list_agents']
          const agTools = (ag.tools.includes('*') ? TOOLS : TOOLS.filter((tt: ToolSpec) => ag.tools.includes(tt.function.name))).filter((tt: ToolSpec) => !COLLAB_TOOLS.includes(tt.function.name))
          const rid = 'sub' + Date.now() + '_' + tasks.indexOf(t) + '_' + Math.random().toString(36).slice(2, 6)
          const subMsgs: LLMMessage[] = [
            { role: 'system', content: sp },
            { role: 'user', content: '[任务分派] ' + (t.task || '') + '\n[必要上下文] (仅任务所需, 无全局会话历史)' },
          ]
          let subText = ''
          let subRounds = 0
          let subRetried = false
          const subRun = () => new Promise<string>((resolve) => {
            const step = () => {
              subRounds++
              if (subRounds > SUB_ROUND_LIMIT) { resolve(subText || '(子任务轮次上限)'); return }
              // 防御性清理 —— 丢弃孤儿 tool 消息(前面不是带 tool_calls 的 assistant), 防止 DeepSeek 400
              const clean: LLMMessage[] = []
              for (const mm of subMsgs) {
                if (mm.role === 'tool') {
                  const prev = clean[clean.length - 1]
                  if (!prev || prev.role !== 'assistant' || !prev.tool_calls) continue
                }
                clean.push(mm)
              }
              if (clean.length !== subMsgs.length) { subMsgs.length = 0; subMsgs.push(...clean) }
              let text = ''
              const tcs: { id: string; name: string; args: Record<string, unknown> }[] = []
              const cbs: (() => void)[] = []
              let settled = false
              const settle = () => {
                if (settled) return; settled = true
                cbs.forEach(f => f())
                if (tcs.length) {
                  ;(async () => {
                    for (const tc of tcs) {
                      const tcId = tc.id || 'c' + Date.now() + Math.random().toString(36).slice(2, 6)
                      // v0.3.0 M3: 子 Agent 工具白名单守卫(LLM 幻觉兜底)
                      if (!ag.tools.includes('*') && !ag.tools.includes(tc.name)) { subMsgs.push({ role: 'assistant', content: null, reasoning_content: '', tool_calls: [{ id: tcId, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] }); subMsgs.push({ role: 'tool', content: 'E:权限不足，该 Agent 无权调用 ' + tc.name, tool_call_id: tcId }); continue }
                      const rr = await runToolFn(tc.name, tc.args || {}, cfg)
                      subMsgs.push({ role: 'assistant', content: null, reasoning_content: '', tool_calls: [{ id: tcId, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }] })
                      subMsgs.push({ role: 'tool', content: rr, tool_call_id: tcId })
                    }
                    step()
                  })()
                } else {
                  subText = text
                  resolve(text)
                }
              }
              cbs.push(window.huangquan.llm.onChunk((d: ChunkData) => { if (d && d.requestId && d.requestId !== rid) return; if (d.content) text += d.content; if (d.done) setTimeout(settle, 200) }))
              cbs.push(window.huangquan.llm.onToolCall((tc: ToolCallDelta) => { if (tc && tc.requestId && tc.requestId !== rid) return; if (tc?.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) }))
              cbs.push(window.huangquan.llm.onError((e: unknown) => {
                if (settled) return; settled = true; cbs.forEach(f => f())
                // 用户终止任务后不重试(终止由 taskGen 变化标记)
                if (getTaskGen() !== dispStartGen) { resolve('已终止'); return }
                const em = e as { error?: string }
                const msg = typeof e === 'string' ? e : (em?.error || errMsg(e) || JSON.stringify(e))
                if (!subRetried) { subRetried = true; setTimeout(step, 400); return }
                resolve('E:' + msg)
              }))
              window.huangquan.llm.chat({ provider: p.type, model, apiKey: p.apiKey, baseUrl: p.baseUrl, messages: subMsgs, tools: agTools, requestId: rid }).catch((e: unknown) => {
                if (settled) return; settled = true; cbs.forEach(f => f())
                if (getTaskGen() !== dispStartGen) { resolve('已终止'); return }
                const msg = errMsg(e)
                if (!subRetried) { subRetried = true; setTimeout(step, 400); return }
                resolve('E:' + msg)
              })
            }
            step()
          })
          const r = await subRun()
          return { agent: t.agent, task: t.task, result: r }
        }))
        for (const x of results) {
          const xr = x as { error?: string; result?: string }
          const err = xr.error ? ' (未知Agent)' : ''
          out.push(`【${x.agent}${err}】${xr.error || ''}\n任务: ${x.task}\n结果: ${xr.result || '(empty)'}`)
        }
        return '📤 分发完成，共 ' + tasks.length + ' 个子任务：\n\n' + out.join('\n\n---\n\n')
}
