// src/store/chat-send.ts — 渲染层发送客户端(v0.3.3 独立内核)
// 旧 runSend 主循环已迁入主进程 AgentEngine(electron/engine/engine.ts), 本文件只保留:
// 会话 store 类型 S + 用户消息构建 + 引擎启动/插话客户端。死代码已删除, 不再双维护。
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, PlanStepView, PlanState } from '../global'
import { errMsg } from '../utils/safe'
import { detectInterjectKind } from './interject'
import { buildUserMessage } from './chat-user-msg'

// 会话级任务代号表(兼容旧引用; 引擎在主进程有独立代号)
export const taskGenBySid: Record<string, number> = {}

// v0.3.7: 计划类型已迁移到 types/domain, 此处 re-export 兼容旧引用
export type { PlanStepView, PlanState }

export interface S {
  sessions: SessionData[]; cid: string | null; streaming: boolean; executing: boolean; error: string | null
  errorStep: { messageId?: string } | null
  fileChanges: number
  lastTaskId: string
  stage: { sid: string; phase: 'thinking' | 'tool'; label: string; detail: string } | null
  terminal: { id: string; name: string; args: Record<string, unknown>; result: string; time: number }[]
  cu: number; cl: number
  curModel: string
  sessCache: Record<string, { hits: number; misses: number }>
  modelCache: Record<string, { hits: number; misses: number }>
  sessTok: Record<string, Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; outputTokens: number; hitReqs: number }>>
  streamText: string // 引擎流式临时文字(不落消息, 由 step/final 事件承载最终内容)
  streamId: string // 当前流式通道归属的消息 id —— delta 按 id 隔离, 防止并行任务/插话串文
  activeAgents: string[]
  orphanTasks: { id: string; sid: string; content: string; images?: string[]; attachments?: Message['attachments']; at: number; planProgress?: string }[]
  plans: Record<string, PlanState>
  clarifyReq: { sid: string; requestId: string; question: string; choices: string[]; multiSelect: boolean } | null
  load: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  create: () => void
  switchS: (id: string) => Promise<void>
  del: (id: string) => void
  togglePin: (id: string) => void
  send: (c: string, imgs?: string[], attachments?: Message['attachments']) => Promise<void>
  resendFrom: (msgId: string, newContent?: string) => Promise<void>
  regen: () => Promise<void>
  stop: () => void
  restoreTask: (id: string) => Promise<void>
  cur: () => SessionData | undefined
}

// 渲染层只负责构建用户消息 + 启动引擎, 循环全部在主进程
export async function clientSend(
  deps: { set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void; get: () => S },
  content: string,
  images?: string[],
  attachments?: Message['attachments']
): Promise<void> {
  const set = deps.set
  const get = deps.get
  let sid = get().cid
  if (!sid) { get().create(); sid = get().cid! }
  const thisBusy = get().sessions.find(x => x.id === sid)?.busy
  if (thisBusy) {
    const cur = get().sessions.find(x => x.id === sid)
    const recentMsgs = cur?.messages.slice(-6) || []
    const hasToolCall = recentMsgs.some(m => m.tool_calls)
    const lastRole = recentMsgs.slice(-1)[0]?.role
    const inToolWork = lastRole === 'tool' || hasToolCall
    const partialReply = recentMsgs.filter(m => m.role === 'assistant' && m.content).slice(-1)[0]?.content?.slice(0, 200) || ''
    const isRetarget = detectInterjectKind(content) === 'retarget'
    const prefix = inToolWork
      ? (isRetarget
        ? `（用户在工作执行中发出改向指令，请停止当前操作，按新指令调整方向。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。）\n`
        : `（用户在工作执行中插话补充。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。请结合当前进度理解用户意图并调整后续操作。）\n`)
      : `（用户在回复中插话补充。以下是补充指令。）\n`
    // 消息由引擎 interject 事件统一上屏, 避免本地先加 + 事件再加导致双写
    await window.huangquan.engine.interject(sid, content, images, attachments, isRetarget ? 'retarget' : 'supplement', prefix).catch(() => {})
    return
  }
  set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: true } : x) }))
  const um = await buildUserMessage({ sid, get, set: set as (partial: unknown, replace?: boolean) => void }, content, images, attachments)
  const cur = get().sessions.find(x => x.id === sid)
  const taskId = uuidv4()
  try {
    // v0.3.7: 新任务清掉上一任务的计划卡片, 重新走计划流
    set(s => { const plans = { ...s.plans }; delete plans[sid]; return { plans } })
    // 停止后旧任务可能尚未完全退出：开新任务前先确保主进程旧任务已失效，避免被当成插话继续跑
    await window.huangquan.engine.stop(sid).catch(() => {})
    await window.huangquan.engine.start({
      sid,
      taskId,
      content: um.content,
      images: um.images,
      attachments,
      userMsgId: um.userMsgId,
      userMsgTimestamp: um.userMsg.timestamp,
      history: (cur?.messages || [um.userMsg]) as never,
      agent: cur?.agent,
      agentManual: cur?.agentManual,
    })
  } catch (e) {
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false, streaming: false } : x) }))
    set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: errMsg(e) }))
  }
}
