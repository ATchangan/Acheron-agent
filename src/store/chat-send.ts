import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage, SettingsData, UsageData, ProviderConfig, VisionContent, SkillMeta, SessionMeta, ToolCallDelta } from '../global'
import type { GeneralSettings } from '../types'
import { useSettingsStore } from './settings'
import { TOOLS } from './tools'
import { safeIPC, errMsg, debugLog } from '../utils/safe'
import { CACHE_TTL, WORKFLOWS } from './constants'
import { estimateTokens, getModelContextLimit, updateContextLimit, isVisionModel, buildPrompt, buildContextualMessages } from './context'
import { recordEpisodic, autoExtractMemory, refreshMemoryCache, freezeMemory } from './memory'
import { setProjectContext } from './project-ctx'
import { routeAgent } from './router'
import { analyzeWithVision, buildVisionCandidates, runTool, getActiveTools, taskGen, nextTaskGen, costedReqs, setCached, getCached, onWriteOp } from './runtime'
import { normalizeImage } from '../utils/image'
import { nextTaskGenFor, getTaskGenFor, invalidateSid, scheduleResume, cancelResume } from './session-state'
import { pickModels, resolveModel } from './model-pick'
import { pushInterject, hasInterjectForSid, drainInterjections, clearInterjectForSid, detectInterjectKind } from './interject'
import { runToolRound } from './chat-round'
import type { CallResult } from './chat-round'
import { createCallLLM } from './chat-llm'
import { maybeAutoResume, checkSendIdempotent } from './resume-ops'
import { buildUserMessage } from './chat-user-msg'
import { refreshPluginTools } from './plugins'

// v0.3.1 块 C/D: 会话级任务代号表 + send 幂等指纹(模块级, 串行入口安全)
export const taskGenBySid: Record<string, number> = {}
// v0.3.1 D3: 长任务中途保存时间戳 —— 按会话隔离(双会话并发时 A 保存不压掉 B)
const midSaveBySid: Record<string, number> = {}

// v0.3.0 M5: 工具调用循环中的扁平工具项(组件收集, 非 API delta)
interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
}

// v0.3.1 块 I: 会话 store 状态类型(从 chat.ts 迁入, 供 runSend deps 精确类型)
export interface S {
  sessions: SessionData[]; cid: string | null; sp: string; spIshiki: string; streaming: boolean; executing: boolean; error: string | null
  stage: { sid: string; phase: 'thinking' | 'tool'; label: string; detail: string } | null
  terminal: { id: string; name: string; args: Record<string, unknown>; result: string; time: number }[]
  cu: number; cl: number
  curModel: string
  sessCache: Record<string, { hits: number; misses: number }>
  modelCache: Record<string, { hits: number; misses: number }>
  sessTok: Record<string, Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; outputTokens: number; hitReqs: number }>>
  activeAgents: string[]
  load: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  create: () => void
  switchS: (id: string) => void
  del: (id: string) => void
  send: (c: string, imgs?: string[], attachments?: Message['attachments']) => Promise<void>
  resendFrom: (msgId: string, newContent?: string) => Promise<void>
  regen: () => Promise<void>
  stop: () => void
  cur: () => SessionData | undefined
}

// v0.3.1 块 I: send 主逻辑(从 chat.ts 拆出, 行为零变化)
// v0.3.1 M3: 发送锁 —— 同一会话同时刻只允许一个任务在跑(双连发第二条走插话路径)
const sendLockBySid: Record<string, boolean> = {}
export async function runSend(
  deps: { set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void; get: () => S },
  content: string,
  images?: string[],
  attachments?: Message['attachments']
): Promise<void> {
  const taskStart = Date.now() // 任务总时长起点(含工具执行, 用于最终气泡 ⏱ 显示)
  const set = deps.set
  const get = deps.get
  const st0 = get()
  let sid = st0.cid; if (!sid) { get().create(); sid = get().cid! }
  // 会话级忙碌判断 —— 仅当"本会话"正在工作时才走插话；其他会话在工作不影响本会话独立发送
  // v0.3.1 M3: 发送锁占用也走插话路径(双连发不覆盖)
  const thisBusy = get().sessions.find(x => x.id === sid)?.busy || !!sendLockBySid[sid]
  if (thisBusy) {
    // 探测当前工作状态
    const cur = get().sessions.find(x => x.id === sid)
    const recentMsgs = cur?.messages.slice(-6) || []
    const hasToolCall = recentMsgs.some(m => m.tool_calls)
    const lastRole = recentMsgs.slice(-1)[0]?.role
    const inToolWork = lastRole === 'tool' || hasToolCall
    const partialReply = recentMsgs.filter(m => m.role === 'assistant' && m.content).slice(-1)[0]?.content?.slice(0, 200) || ''
    // v0.3.1 M3: 改向关键词识别(retarget 前缀措辞改向版)
    const isRetarget = detectInterjectKind(content) === 'retarget'
    // 插话标记
    const prefix = inToolWork
      ? (isRetarget
        ? `（用户在工作执行中发出改向指令，请停止当前操作，按新指令调整方向。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。）\n`
        : `（用户在工作执行中插话补充。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。请结合当前进度理解用户意图并调整后续操作。）\n`)
      : `（用户在回复中插话补充。以下是补充指令。）\n`
    // 用户消息立即上屏(_inject 标记: 构建上下文时重排到末尾, 保证 API 消息序列合法)
    const interjectMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments, _inject: true }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, interjectMsg] } : x) }))
    // 补充指令进入队列(kind 由内容识别, retarget 独立成项触发工具链熔断)，当前任务继续执行
    pushInterject(sid, prefix + content, isRetarget ? 'retarget' : 'supplement')
    return
  }
  sendLockBySid[sid] = true
  const myGen = nextTaskGenFor(taskGenBySid, sid) // v0.3.1 C2: 会话级任务代号(仅本会话失效)
  // v0.3.1 D2: send 幂等去重(同一内容 500ms 内重复发送直接忽略)
  const fpD = content + '|' + (images || []).join('|')
  if (checkSendIdempotent(fpD)) return

  // 标记本会话为忙碌（侧栏"工作中"指示灯 + 独立并发）
  set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: true } : x) }))
  // v0.2: 插话模式下不重置 streaming，让 UI 平滑过渡
  const wasInterjecting = st0.streaming

  // v0.3.1 B1: 会话级 Agent 状态接管 —— 新任务开始不清 agent（会话字段保持, 避免多会话并发覆盖）
  // 全局 activeAgents/__huangquan_agent 由会话字段读写迁移（块 B）取代, window 仅保留兼容镜像

  // 1. 获取 provider 和模型
  const cfg = await window.huangquan.settings.load()
  // 任务配置快照 —— 任务执行期间用快照, 用户改设置不影响当前任务
  const gSnap = (cfg.general || {}) as GeneralSettings
  // 已配置供应商优先(原 providers[0] 可能无 key, 首个空配置会挡住对话)
  const p = cfg.providers.find((x: ProviderConfig) => x.apiKey && x.baseUrl) || cfg.providers[0]; if (!p) { set({ streaming: false, executing: false, error: '请先配置 API Provider' }); return }
  // 发送前刷新全局记忆缓存（置顶/长期记忆对所有会话生效）
  // 刷新后冻结本次任务记忆快照(会话内各轮一致, 前缀缓存友好)
  await refreshMemoryCache().catch(() => {})
  freezeMemory(content)
  // 读取工作目录项目约定文件(约定自动注入上下文)
  try {
    const pc = await window.huangquan.projectContext().catch(() => ({ file: '', content: '' }))
    if (pc && pc.file) setProjectContext(pc)
  } catch { /* 忽略 */ }
  // 多模型策略接入 —— mainModel/longTextModel/codeModel/fastModel（"providerId::model" 或 "model"）
  const gNow = gSnap
  const mc = pickModels(gSnap, cfg, p, content, images)
  const main = mc.main, isSimple = mc.isSimple, fast = mc.fast, small = mc.small, large = mc.large
  let curP = mc.chosen.p, model = mc.chosen.model
  // 调度选择日志(定位切换失效问题)
  debugLog('[MODEL] 选择:', model, '@', curP?.name || '?', '| 简单任务:', isSimple, '| 调度: 小=' + (small?.model || '-') + ' 大=' + (large?.model || '-') + ' 主=' + (main.model || '-'))
  set({ curModel: model || '' })
  // 暴露最近一次实际发送模型(验证调度绑定/多模型策略接线)
  
  updateContextLimit(model)

  // 记录当前活跃 Agent（路由结果），供右侧面板展示
  const recordAgent = (name: string) => {
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, activeAgents: (x.activeAgents || []).includes(name) ? x.activeAgents : [...(x.activeAgents || []), name] } : x) }))
  }
  const curS0 = get().sessions.find(x => x.id === sid)
  if (curS0?.agent) recordAgent(curS0.agent)

  // 用户消息构建 + 视觉任务判定(拆至 chat-user-msg.ts, 行为零变化)
  const um = await buildUserMessage({ sid, get, set: set as (partial: unknown, replace?: boolean) => void }, content, images, attachments)
  content = um.content; images = um.images
  const userMsg = um.userMsg
  const userMsgId = um.userMsgId
  const tokBase = um.tokBase
  let isVisualTask = um.isVisualTask
  const imgPathMatch = um.imgPathMatch
  // 任务开始前保存主力模型(视觉任务结束后 finally 还原)
  const origP = curP, origModel = model
  let switchedVision = false   // 事实标记: 是否真的切换过视觉模型
  // v0.3.0 FIX-E: 视觉候选单一来源(buildVisionCandidates) —— 队列调度只用文字供应商(apiKey/baseUrl 判定, MediaProvider 跳过留给 analyzeWithVision 兜底)
  const allProvsNow = useSettingsStore.getState().providers || []
  const visQueue = buildVisionCandidates(p)
    .filter(c => 'apiKey' in c.vp && c.vp.apiKey && c.vp.baseUrl)
    .map(c => ({ p: c.vp as ProviderConfig, model: c.vm }))
  debugLog('[MODEL] 视觉任务判定:', isVisualTask, '| 当前模型:', model, '| 视觉队列:', visQueue.map(q => q.model).join(',') || '(空)')
  if (isVisualTask) {
    // 队列非空 → 强制使用队列第一个可用模型(按优先级); 当前模型已在队列则保持
    const curInQueue = visQueue.find(q => q.model === model)
    if (visQueue.length) {
      if (!curInQueue) {
        curP = visQueue[0].p; model = visQueue[0].model
        set({ curModel: model || '' }); updateContextLimit(model)
        
        content = content + '\n\n[识图任务已使用视觉模型:' + model + ']'
        switchedVision = true
        debugLog('[MODEL] 视觉任务强制切换队列模型:', model)
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsgId ? { ...m, content } : m) } : x) }))
      }
    } else if (isVisionModel(model)) {
      // 无队列配置但当前模型支持视觉: 直接传图
    } else {
      // 队列空 + 当前不支持: 自动候选(同供应商优先, 排除绘图模型)
      const samePModel = (curP.models || []).find(m => isVisionModel(m))
      const otherP = allProvsNow.find(x => x.id !== curP.id && x.apiKey && x.baseUrl && (x.models || []).some(m => isVisionModel(m)))
      const alt = samePModel ? { p: curP, model: samePModel } : (otherP ? { p: otherP, model: (otherP.models || []).find(m => isVisionModel(m))! } : null)
      if (alt) {
        curP = alt.p; model = alt.model
        set({ curModel: model || '' }); updateContextLimit(model)
        
        content = content + '\n\n[已自动切换模型:' + model + '(支持图片分析)]'
        switchedVision = true
        debugLog('[MODEL] 视觉任务自动切换:', model)
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsgId ? { ...m, content } : m) } : x) }))
      } else {
        // 无可用视觉模型: 走辅助视觉分析, 分析失败则提示
        set(s => ({ executing: s.cid === sid ? true : s.executing }))
        const visionDesc = await analyzeWithVision(p, images || [], content)
        if (visionDesc && !visionDesc.startsWith('E:')) {
          content = content + '\n\n[图片内容（视觉模型分析）]\n' + visionDesc
        } else {
          let why = ''
          if (visionDesc === 'E:no-vision-model') why = '未配置可用的视觉辅助模型'
          else if (visionDesc && visionDesc.startsWith('E:ALL_VISION_FAILED')) {
            const fails = visionDesc.replace(/^E:ALL_VISION_FAILED:\s*/, '').split(' | ')
            why = '所有视觉辅助模型均无法连通：' + fails.join('；')
          } else why = (visionDesc || '').replace(/^E:/, '') || '视觉分析失败'
          content = content + '\n\n[图片未能分析：' + why + '。可在 设置→策略→👁️视觉理解 中配置视觉辅助模型优先级（如通义 qwen-vl、智谱 glm-4v、Kimi vision 等）。]'
        }
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsgId ? { ...m, content } : m) } : x) }))
      }
    }
  }


  const callLLM = createCallLLM({ sid, gSnap, get, set, getModel: () => model, getCurP: () => curP })


  try {
    // 每次 LLM 调用独立超时保护 —— 只中止当前请求(requestId), 不再误杀其他会话并发请求
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    // toolTimeout 设置接入 —— 默认 120s, 可在设置中调整
    const toolTimeout = Number(gSnap.toolTimeout) || 120000
    const guard = (rid: string) => { timeoutId = setTimeout(() => window.huangquan.llm.abort(rid), toolTimeout) }
    const clear = () => { if (timeoutId) clearTimeout(timeoutId) }

    // 主执行循环 —— 正常轮次 + 插话补充轮次（工作中插话=补充指令，任务继续而非重开）
    let roundNum = 0
    let aid = ''
    let res: CallResult = { text: '', tcs: [] }
    let toolLog: { name: string; args: Record<string, unknown>; result: string; error: boolean; ms: number }[] = []
    while (true) {
      roundNum++
      if (myGen !== getTaskGenFor(taskGenBySid, sid)) break // 被终止
      // 2. 创建空的 assistant 占位（每轮一个新气泡位）
      aid = uuidv4()
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))
      // 消费插话补充（第 2 轮起）—— 可见性由 _inject 标记条承担(构建时重排到末尾, 不再重复注入消息)
      // 消费动作仅用于主循环退出判定(队列空则 break), 内容丢弃不注入
      while (hasInterjectForSid(sid)) drainInterjections(sid)

      const rid1 = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
      guard(rid1)
      set({ stage: { sid, phase: 'thinking', label: '思考中', detail: '' } })
      // 视觉任务模型轮询 —— 调用失败自动顺位下一个视觉模型(队列优先级), 全部失败清晰报错
      if (isVisualTask && visQueue.length > 1) {
        const tried: string[] = []
        let okRes: CallResult | null = null
        let lastErr: unknown = null
        for (const q of visQueue) {
          if (q.model !== model && tried.length > 0) { curP = q.p; model = q.model; switchedVision = true; set({ curModel: model }); updateContextLimit(model) }
          tried.push(model)
          try { okRes = await callLLM(aid, rid1); clear(); break }
          catch (e) { lastErr = e; clear(); debugLog('[MODEL] 视觉模型调用失败, 顺位下一个:', model, '->', String(e).slice(0, 120)); continue }
        }
        if (okRes) res = okRes
        else {
          res = { text: '', tcs: [] }
          const whyTxt = '所有视觉模型均调用失败：' + tried.join('、') + (lastErr ? '（' + String((lastErr as { message?: string })?.message || lastErr).slice(0, 150) + '）' : '')
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: '[识图失败] ' + whyTxt } : m) } : x) }))
          debugLog('[MODEL] 视觉队列全部失败:', whyTxt)
          break // 跳出 while 主循环(本轮结束, 用户可见报错)
        }
      } else {
        res = await callLLM(aid, rid1); clear()
      }

      // 3. 工具调用循环(拆至 chat-round.ts, 行为零变化)
      const tr = await runToolRound({ sid, myGen, gSnap, cfg, p, taskGenBySid, visQueue, isVisualTask, set, get, callLLM, guard, clear, applySwitch: (s2) => { curP = s2.p; model = s2.model; set({ curModel: model }); updateContextLimit(model) } }, res, toolLog, midSaveBySid[sid] || 0)
      res = tr.res; toolLog = tr.toolLog; midSaveBySid[sid] = tr.lastMidSave
      if (tr.switchTo) { curP = tr.switchTo.p; model = tr.switchTo.model; set({ curModel: model }); updateContextLimit(model) }
      // 4. 单气泡合并
      set({ stage: null }) // 任务完成, 思考气泡消失
      const finalSession = get().sessions.find(x => x.id === sid)
      if (finalSession) {
        // 合并本轮所有 assistant 文本 → 单一气泡（工具循环中间轮的文字并入最终回复）
        // v0.3.1 D1: 清空边界 = 任务起始消息(userMsg.id 首次出现)之后的所有中间 assistant 文本(插话 user 消息不破坏边界)
    const lastUserIdx = finalSession.messages.map(m => m.id).indexOf(userMsg.id)
        const thisRound = lastUserIdx >= 0 ? finalSession.messages.slice(lastUserIdx) : finalSession.messages
        // 单气泡合并: DeepSeek 等模型在工具调用前会先输出一遍预答, 工具执行后再次输出最终回答,
        // 若把两者都并入会重复。检测中间文本与最终输出相同则丢弃该重复段(保留更早的阶段性说明)
        const roundMid = thisRound.filter(m => m.role === 'assistant' && m.content && m.id !== aid).map(m => m.content as string)
        const llmText = res.text || ''; const hasTools = toolLog.length > 0
        const lastMid = roundMid[roundMid.length - 1]
        const midTexts = (lastMid && llmText && lastMid === llmText) ? roundMid.slice(0, -1) : roundMid
        let finalContent = [ ...midTexts, llmText ].filter(Boolean).join('\n\n')
        // 工具日志已改为写入右侧终端面板(terminal), 不再拼进消息正文(原死代码块已删除)
        // 中间轮 assistant 文本已并入最终气泡，清空其 content（UI 单气泡，API 上下文仍保留占位）
        // 只清空【本轮内】的中间 assistant 消息 —— 之前遍历整个会话导致历史回复全部被清空
        const roundIds = new Set(thisRound.map(m => m.id))
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => (roundIds.has(m.id) && m.role === 'assistant' && m.content && m.id !== aid) ? { ...m, content: '' } : (m.id === aid ? { ...m, content: finalContent, _toolLog: toolLog } : m)) } : x) }))
      }

      // 有插话补充且未被终止 → 继续下一轮（任务不中断）
      if (myGen !== getTaskGenFor(taskGenBySid, sid) || !hasInterjectForSid(sid)) break
    }

    // 本任务总消耗 = sessTok 增量(含主 Agent 与全部子 Agent), 写到最后一条 assistant 消息
    try {
      const tokNow = get().sessTok[sid] || {}
      let taskTok = 0
      for (const [mk, c] of Object.entries(tokNow)) {
        const b = tokBase[mk]
        // 总消耗 = 输入(已含缓存命中) + 输出 + 缓存写入; 不再重复加 readTokens
        taskTok += (c.inputTokens - (b?.inputTokens || 0)) + (c.outputTokens - (b?.outputTokens || 0)) + (c.writeTokens - (b?.writeTokens || 0))
      }
      if (taskTok > 0) {
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map((m, idx) => {
          if (m.role === 'assistant') {
            let lastAi = -1
            for (let k = x.messages.length - 1; k >= 0; k--) if (x.messages[k].role === 'assistant') { lastAi = k; break }
            if (idx === lastAi) return { ...m, meta: { ...m.meta, taskTokens: taskTok, taskMs: Date.now() - taskStart } }
          }
          return m
        }) } : x) }))
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false, streaming: false, activeAgents: undefined } : x) }))
    // v0.3.1 插话序列修复 D2: 任务收尾清除 _inject 标记(插话消息转普通, 位置在末尾——序列仍合法)
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m._inject ? { ...m, _inject: false } : m) } : x) }))
    clearInterjectForSid(sid)
    set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: null, activeAgents: s.cid === sid ? [] : s.activeAgents }))
    maybeAutoResume({ sid, myGen, taskGenBySid, get, set: set as (partial: unknown, replace?: boolean) => void })
    const toSave = get().sessions.find(x => x.id === sid)
    if (toSave) { window.huangquan.sessions.save(safeIPC(toSave)); autoExtractMemory(sid, get().sessions).catch(() => {}) }
  } catch (e: unknown) {
    const errText = (e instanceof Error ? e.message : String(e))
    // 栈溢出/异常友好化 —— 图片处理或模型调用异常时给出可操作提示, 不再裸抛
    const friendly = /maximum call stack|stack size|RangeError|too much recursion/i.test(errText)
      ? '处理任务时出现异常（可能是图片过大或模型调用过深）。建议：换较小的图片重试，或在 设置→策略 中检查视觉/主模型配置。' + (images?.length ? '（本次为图片任务）' : '')
      : errText
    // API 不接受 image_url 时（模型实际不支持视觉），移除图片后自动重试一次纯文本
    if (images?.length && /image_url|image url|image data/i.test(errText)) {
      console.warn('[黄泉Agent] 模型不支持图片，自动降级为纯文本重试:', errText.slice(0, 120))
      try {
        // 简化 —— 直接按 userMsg.id 过滤, 消除冗余查找
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.filter(m => m.id !== userMsg?.id) } : x) }))
      } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false, streaming: false } : x) }))
      set({ executing: false, error: null })
      return get().send(content, undefined, attachments)
    }
    console.error('[黄泉Agent] send error:', e)
    // 异常后清理悬空 tool_calls 消息(无对应 tool 结果): 否则下次请求 API 400
    try {
      set(s => ({ sessions: s.sessions.map(x => {
        if (x.id !== sid) return x
        const msgs = x.messages
        const keep = (m: Message) => !m.tool_calls?.length || m.tool_calls.some(tc => msgs.some(t => t.role === 'tool' && t.tool_call_id === tc.id))
        return { ...x, messages: msgs.filter(keep) }
      }) }))
    } catch { /* 忽略 */ }
    // 异常/插话中止时清理当前流式 assistant 残留（避免多气泡）
    try {
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsg?.id && !m.content ? { ...m, content: '' } : m) } : x) }))
    } catch (e) { /* 会话可能已删除 */ console.debug('[swallow]', e) }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
    set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: s.cid === sid ? friendly : s.error, stage: s.cid === sid ? null : s.stage, activeAgents: s.cid === sid ? [] : s.activeAgents }))
  } finally {
    // v0.3.1 M3: 发送锁释放(正常/异常/中断三路径统一走 finally)
    delete sendLockBySid[sid]
    // v0.3.0 FIX-B: 模型还原唯一入口 —— 只要真的切换过(switchedVision), 无论正常/异常/中断都还原主力模型
    if (switchedVision && origModel && origModel !== model) {
      curP = origP; model = origModel
      set({ curModel: model }); updateContextLimit(model)
      
      debugLog('[MODEL] 视觉任务结束, 还原主力模型:', model)
    }
  }
}
