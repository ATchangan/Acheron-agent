import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage, SettingsData, UsageData, ProviderConfig, VisionContent, SkillMeta, SessionMeta, ToolCallDelta } from '../global'
import type { GeneralSettings } from '../types'
import { useSettingsStore } from './settings'
import { TOOLS } from './tools'
import { safeIPC, errMsg } from '../utils/safe'
import { CACHE_TTL, WORKFLOWS } from './constants'
import { estimateTokens, getModelContextLimit, updateContextLimit, isVisionModel, buildPrompt, buildContextualMessages } from './context'
import { recordEpisodic, autoExtractMemory, refreshMemoryCache } from './memory'
import { routeAgent } from './router'
import { analyzeWithVision, buildVisionCandidates, runTool, getActiveTools, taskGen, nextTaskGen, costedReqs, setCached, getCached, onWriteOp } from './runtime'
import { normalizeImage } from '../utils/image'
import { nextTaskGenFor, getTaskGenFor, invalidateSid, scheduleResume, cancelResume } from './session-state'
import { refreshPluginTools } from './plugins'

// v0.3.1 块 C/D: 会话级任务代号表 + send 幂等指纹(模块级, 串行入口安全)
export const taskGenBySid: Record<string, number> = {}
let lastSendFp = ''; let lastSendTs = 0
let lastMidSave = 0 // v0.3.1 D3: 长任务中途保存时间戳

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
  sessTok: Record<string, Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number }>>
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

// v0.2.1: 插话补充队列 —— 工作中插话=给当前任务补充指令，任务不中断，下一轮执行时注入
// 插话队列带会话归属 —— 多会话并发时插话只被本会话消费, 防串台
let pendingInterject: { sid: string; text: string }[] = []
export const clearInterjectForSid = (sid: string) => { pendingInterject = pendingInterject.filter(x => x.sid !== sid) }

// v0.3.1 块 I: send 主逻辑(从 chat.ts 拆出, 行为零变化)
export async function runSend(
  deps: { set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void; get: () => S },
  content: string,
  images?: string[],
  attachments?: Message['attachments']
): Promise<void> {
  const set = deps.set
  const get = deps.get
  const st0 = get()
  let sid = st0.cid; if (!sid) { get().create(); sid = get().cid! }
  // v0.2.3: 会话级忙碌判断 —— 仅当"本会话"正在工作时才走插话；其他会话在工作不影响本会话独立发送
  const thisBusy = get().sessions.find(x => x.id === sid)?.busy
  if (thisBusy) {
    // 探测当前工作状态
    const cur = get().sessions.find(x => x.id === sid)
    const recentMsgs = cur?.messages.slice(-6) || []
    const hasToolCall = recentMsgs.some(m => m.tool_calls)
    const lastRole = recentMsgs.slice(-1)[0]?.role
    const inToolWork = lastRole === 'tool' || hasToolCall
    const partialReply = recentMsgs.filter(m => m.role === 'assistant' && m.content).slice(-1)[0]?.content?.slice(0, 200) || ''
    // 插话标记
    const prefix = inToolWork
      ? `（用户在工作执行中插话补充。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。请结合当前进度理解用户意图并调整后续操作。）\n`
      : `（用户在回复中插话补充。以下是补充指令。）\n`
    // 用户消息立即上屏
    const interjectMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, interjectMsg] } : x) }))
    // 补充指令进入队列，当前任务继续执行
    pendingInterject.push({ sid, text: prefix + content })
    return
  }
  const myGen = nextTaskGenFor(taskGenBySid, sid) // v0.3.1 C2: 会话级任务代号(仅本会话失效)
  // v0.3.1 D2: send 幂等去重(同一内容 500ms 内重复发送直接忽略)
  const fpD = content + '|' + (images || []).join('|')
  const nowD = Date.now()
  if (lastSendFp === fpD && nowD - lastSendTs < 500) return
  lastSendFp = fpD; lastSendTs = nowD

  // v0.2.3: 标记本会话为忙碌（侧栏"工作中"指示灯 + 独立并发）
  set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: true } : x) }))
  // v0.2: 插话模式下不重置 streaming，让 UI 平滑过渡
  const wasInterjecting = st0.streaming

  // v0.3.1 B1: 会话级 Agent 状态接管 —— 新任务开始不清 agent（会话字段保持, 避免多会话并发覆盖）
  // 全局 activeAgents/__huangquan_agent 由会话字段读写迁移（块 B）取代, window 仅保留兼容镜像

  // 1. 获取 provider 和模型
  const cfg = await window.huangquan.settings.load()
  // v0.2.4: 任务配置快照 —— 任务执行期间用快照, 用户改设置不影响当前任务
  const gSnap = (cfg.general || {}) as GeneralSettings
  // 已配置供应商优先(原 providers[0] 可能无 key, 首个空配置会挡住对话)
  const p = cfg.providers.find((x: ProviderConfig) => x.apiKey && x.baseUrl) || cfg.providers[0]; if (!p) { set({ streaming: false, executing: false, error: '请先配置 API Provider' }); return }
  // v0.2.3: 发送前刷新全局记忆缓存（置顶/长期记忆对所有会话生效）
  refreshMemoryCache().catch(() => {})
  // v0.2.1: 多模型策略接入 —— mainModel/longTextModel/codeModel/fastModel（"providerId::model" 或 "model"）
  const gNow = gSnap
  const resolveModel = (key: string): { p: ProviderConfig; model: string } | null => {
    const val = (gNow as unknown as Record<string, string | undefined>)[key]
    if (!val) return null
    const [pid, m] = val.includes('::') ? val.split('::') : [null, val]
    if (pid) { const pr = (cfg.providers || []).find((x: ProviderConfig) => x.id === pid); if (pr && (pr.models || []).includes(m)) return { p: pr, model: m } }
    else if ((p.models || []).includes(val)) return { p, model: val }
    return null
  }
  const main = resolveModel('mainModel') || { p, model: p.selectedModel || p.models[0] || 'deepseek-v4-pro' }
  // 简单任务自动用快速模型（autoFastModel 开启且消息短/无图片时）—— 词表扩充, 减少误判
  const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']
  const isSimple = gNow.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
  const fast = isSimple ? (resolveModel('fastModel') || main) : main
  // v0.2.4: 调度绑定（全局公用，含自定义模型）—— 轻量任务→小模型，复杂任务→大模型
  const small = resolveModel('smallModel')
  const large = resolveModel('largeModel')
  const chosen = isSimple ? (small || fast) : (large || main)
  let curP = chosen.p, model = chosen.model
  // 调度选择日志(定位切换失效问题)
  console.log('[MODEL] 选择:', model, '@', curP?.name || '?', '| 简单任务:', isSimple, '| 调度: 小=' + (small?.model || '-') + ' 大=' + (large?.model || '-') + ' 主=' + (main.model || '-'))
  set({ curModel: model || '' })
  // v0.2.4-debug: 暴露最近一次实际发送模型(验证调度绑定/多模型策略接线)
  try { window.__lastModel = model || '' } catch (e) { /* ignore */ console.debug('[swallow]', e) }
  updateContextLimit(model)

  // v0.2.1: 记录当前活跃 Agent（路由结果），供右侧面板展示
  const recordAgent = (name: string) => {
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, activeAgents: (x.activeAgents || []).includes(name) ? x.activeAgents : [...(x.activeAgents || []), name] } : x) }))
  }
  const curS0 = get().sessions.find(x => x.id === sid)
  if (curS0?.agent) recordAgent(curS0.agent)

  // v0.2.2: 附件（视频/音频/文档）描述拼入消息内容，agent 可用 read_file 等工具读取
  if (attachments && attachments.length) {
    const attachLines = attachments.map(a => `- [${a.kind}] ${a.name}（${(a.size / 1024).toFixed(0)} KB，路径: ${a.path}）`)
    content = content + (content ? '\n\n' : '') + '【用户拖入的附件】\n' + attachLines.join('\n') + '\n如需查看内容，请用 read_file 等工具读取上述路径。'
  }

  // v0.3.0 FIX-A: 图片路径直读 —— 消息含图片文件路径时, 主进程读为 dataURL 并入 images(支持 9 格式)
  // 共享路径变量(供 A1 直读与后续 isVisualTask 判定使用)
  const imgPathRe = /[\w\u4e00-\u9fa5\\\/:\.\- ]+\.(?:png|jpe?g|webp|gif|bmp|svg|avif|heic)/i
  const imgPathMatch = (content || '').match(imgPathRe)
  if (!images?.length && imgPathMatch) {
    const pathTxtA = imgPathMatch[0].trim()
    const raw = await window.huangquan.computer.readFileAsDataUrl(pathTxtA)
    if (raw && !raw.startsWith('E:')) {
      const norm = await normalizeImage(raw)
      if (norm && !norm.startsWith('E:')) images = [norm]
      else content = content + '\n\n[图片处理失败: ' + String(norm).replace(/^E:/, '') + ']'
    } else {
      content = content + '\n\n[图片读取失败: ' + String(raw).replace(/^E:/, '') + '。请确认路径正确或直接拖入图片。]'
    }
  } else if (images?.length) {
    // 拖入图统一压缩(一处覆盖全部后续分支)
    const normed = await Promise.all(images.map((im: string) => normalizeImage(im).catch(() => 'E:decode-failed')))
    const ok = normed.filter((x: string) => x && !x.startsWith('E:'))
    const failN = normed.length - ok.length
    images = ok as string[]
    if (failN > 0) content = content + (content ? '\n\n' : '') + '[' + failN + ' 张图片无法解析, 已忽略]'
  }

  // 1. 追加用户消息到 store —— 立即上屏（不再等视觉分析，避免界面停留初始状态）
  // images 保留原始图片（聊天框 UI 显示）；API 是否传图由 withImages=isVisionModel(model) 决定
  const userMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments }
// v0.2.3: 本任务 token 基线(主 Agent + 全部子 Agent 消耗都计入 sessTok, 任务结束时算增量)
const tokBase: Record<string, { readTokens?: number; inputTokens?: number; writeTokens?: number }> = JSON.parse(JSON.stringify(get().sessTok[sid] || {}))
  const userMsgId = userMsg.id
  set(s => {
    const session = s.sessions.find(x => x.id === sid)!
    // v0.2.1: 会话标题自动取第一条消息（避免一直显示 "New Chat"）
    const isNewChat = !session.title || session.title === 'New Chat' || session.title === 'Chat'
    const title = isNewChat ? content.replace(/\s+/g, ' ').trim().slice(0, 24) + (content.trim().length > 24 ? '…' : '') : session.title
    return { sessions: s.sessions.map(x => x.id === sid ? { ...session, title, messages: [...session.messages, userMsg] } : x), streaming: s.cid === sid ? true : s.streaming, executing: s.cid === sid ? true : s.executing, error: null }
  })

  // v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时，用视觉模型分析图片并转为文本描述
  // 无论视觉分析是否成功，主模型不支持视觉就不向 API 传图（否则 API 400: unknown variant image_url）
  // 用户消息已先上屏，分析完成后更新该消息 content（追加分析结果）
  // 视觉任务(发图/识图) —— 强制优先【视觉理解】队列模型(策略页配置, 按优先级), 队列空回退自动候选;
  // 调用失败自动顺位下一个; 全部失败清晰报错; 禁止纯文本模型处理图像
  // v0.3.0 FIX-F: 视觉任务判定(收紧) —— 发图/路径/明确看图表述; 无图无路径的宽正则命中 → 不切模型并提示
  let isVisualTask = !!(images && images.length) || !!imgPathMatch
    || /(看(一?下|看)?.*(图|照片|截图)|(图|照片|截图).*(什么|内容|识别|分析|描述|里(有|是)什么)|识别.*(图|照片|截图)|视觉理解|图片里|图像里|这张图|这张照片|这个截图)/i.test(content)
  // FIX-F 兜底: 正则命中但 无图 且 无路径 → 不切模型, 提示发图(零 LLM 请求)
  if (isVisualTask && !images?.length && !imgPathMatch) {
    content = content + '\n\n[未检测到图片。如需看图, 请直接拖入图片或提供图片路径。]'
    isVisualTask = false
  }
  // 任务开始前保存主力模型(视觉任务结束后 finally 还原)
  const origP = curP, origModel = model
  let switchedVision = false   // 事实标记: 是否真的切换过视觉模型
  // v0.3.0 FIX-E: 视觉候选单一来源(buildVisionCandidates) —— 队列调度只用文字供应商(apiKey/baseUrl 判定, MediaProvider 跳过留给 analyzeWithVision 兜底)
  const allProvsNow = useSettingsStore.getState().providers || []
  const visQueue = buildVisionCandidates(p)
    .filter(c => 'apiKey' in c.vp && c.vp.apiKey && c.vp.baseUrl)
    .map(c => ({ p: c.vp as ProviderConfig, model: c.vm }))
  console.log('[MODEL] 视觉任务判定:', isVisualTask, '| 当前模型:', model, '| 视觉队列:', visQueue.map(q => q.model).join(',') || '(空)')
  if (isVisualTask) {
    // 队列非空 → 强制使用队列第一个可用模型(按优先级); 当前模型已在队列则保持
    const curInQueue = visQueue.find(q => q.model === model)
    if (visQueue.length) {
      if (!curInQueue) {
        curP = visQueue[0].p; model = visQueue[0].model
        set({ curModel: model || '' }); updateContextLimit(model)
        try { window.__lastModel = model || '' } catch (e) { /* ignore */ console.debug('[swallow]', e) }
        content = content + '\n\n[识图任务已使用视觉模型:' + model + ']'
        switchedVision = true
        console.log('[MODEL] 视觉任务强制切换队列模型:', model)
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
        try { window.__lastModel = model || '' } catch (e) { /* ignore */ console.debug('[swallow]', e) }
        content = content + '\n\n[已自动切换模型:' + model + '(支持图片分析)]'
        switchedVision = true
        console.log('[MODEL] 视觉任务自动切换:', model)
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


  type CallResult = { text: string; tcs: ToolCallItem[] }
  const callLLM = (aid: string, ridArg?: string): Promise<CallResult> =>
    new Promise((resolve, reject) => {
      const cbs: (() => void)[] = []; let text = ''; const tcs: ToolCallItem[] = []
      // v0.2.3: 多会话并发 —— 每次调用独立 requestId，只收自己的流式事件
      // v0.2.3: rid 由外部传入(超时 abort 可精确对应同一请求)
      const rid = ridArg || ('r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))
      // v0.2.2: 记录 TTFT(首字延迟) / 总时长 / token 用量
      const t0 = Date.now(); let firstChunkAt = 0; let usage: UsageData | null = null
      cbs.push(window.huangquan.llm.onUsage(u => {
        if (u && u.requestId && u.requestId !== rid) return
        // v0.2.6: 按模型单价估算本次消费金额
        if (u) {
          // v0.2.6: 用量归一化(监控方案): 兼容 DeepSeek/OpenAI/Anthropic 缓存字段
          // read: prompt_cache_hit_tokens | prompt_tokens_details.cached_tokens | cache_read_input_tokens
          // write: cache_creation_input_tokens(Anthropic 写入缓存, 单独统计)
          const readT = u.prompt_cache_hit_tokens || u.prompt_tokens_details?.cached_tokens || u.cache_read_input_tokens || 0
          const missT = u.prompt_cache_miss_tokens || 0
          const writeT = u.cache_creation_input_tokens || 0
          const inputT = u.prompt_tokens || u.input_tokens || 0
          usage = { ...u, _readTokens: readT, _inputTokens: inputT, _writeTokens: writeT }
          // v0.2.6: 同一次请求的 usage 只统计/累加一次(流式 usage 可能多次到达, 防重复)
          if (!costedReqs.has(rid)) {
            // v0.2.3: 防止无限增长(每 500 条裁剪一半)
            if (costedReqs.size > 500) { const arr = [...costedReqs]; costedReqs.clear(); for (const x of arr.slice(-250)) costedReqs.add(x) }
            costedReqs.add(rid)
            const sid2 = get().cid || ''
            // 持久化埋点(主进程, 会话×模型)
            try {
              window.huangquan.modelStats?.recordRequest(sid2, model, readT > 0)
              if (readT > 0 || inputT > 0 || writeT > 0) window.huangquan.modelStats?.recordTokens(sid2, model, readT, inputT, writeT, missT)
            } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
            // 前端镜像(右侧面板实时显示)
            if (sid2) set(s => {
              const ss = s.sessTok[sid2] || {}
              const c2 = ss[model] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0 }
              return { sessTok: { ...s.sessTok, [sid2]: { ...ss, [model]: { requests: c2.requests + 1, readTokens: c2.readTokens + readT, inputTokens: c2.inputTokens + inputT, writeTokens: c2.writeTokens + writeT, hitReqs: c2.hitReqs + (readT > 0 ? 1 : 0) } } } }
            })
          }
        } else { usage = u }
      }))
      // v0.2.5-opt: 流式渲染节流 —— 40ms 内合并多次 chunk 再 set, 避免每个 token 全量重渲染
      let flushTimer: ReturnType<typeof setTimeout> | null = null
      const flushText = () => {
        flushTimer = null
        const cur = text
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: cur } : m) } : x), streaming: s.cid === sid ? true : s.streaming }))
      }
      cbs.push(window.huangquan.llm.onChunk(d => {
        if (d.requestId && d.requestId !== rid) return // 其他会话的流，忽略
        if (!firstChunkAt && d.content) firstChunkAt = Date.now()
        text += d.content
        if (!flushTimer) flushTimer = setTimeout(flushText, 40)
        if (d.done) {
          if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text } : m) } : x), streaming: s.cid === sid ? false : s.streaming }))
          cbs.forEach(f => f())
          const ttft = firstChunkAt ? firstChunkAt - t0 : (Date.now() - t0)
          const duration = Date.now() - t0
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text, usage: usage || m.usage, meta: { ttft, duration } } : m) } : x) }))
          if (!text && !tcs.length) { reject(new Error('模型返回空响应，请检查 API 配置或切换模型')); return } resolve({ text, tcs })
        }
      }))
      cbs.push(window.huangquan.llm.onError((e: unknown) => {
        const em = e as { error?: string; requestId?: string }
        const errMsg = typeof e === 'string' ? e : (em?.error || String(e))
        if (em && em.requestId && em.requestId !== rid) return // 其他会话的错误，忽略
        cbs.forEach(f => f()); reject(new Error(errMsg))
      }))
      // 工具参数解析失败不再完全静默 —— console.warn 便于排查
      cbs.push(window.huangquan.llm.onToolCall((tc: ToolCallDelta) => { if (tc && tc.requestId && tc.requestId !== rid) return; try { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { console.warn('[黄泉Agent] 工具参数解析失败:', tc?.function?.name, String(tc?.function?.arguments || '').slice(0, 100)) } }))
      const cur = get().sessions.find(x => x.id === sid)!
      const msgs = buildContextualMessages(cur.messages, isVisionModel(model), { gSnap, cl: get().cl, spIshiki: get().spIshiki, spFallback: get().sp, agent: cur.agent, onAgentRoute: (role) => { if (role) { set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, agent: role as string, activeAgents: (x.activeAgents || []).includes(role as string) ? x.activeAgents : [...(x.activeAgents || []), role as string] } : x) })); try { window.__huangquan_agent = role as string } catch (e) { /* ignore */ console.debug('[swallow]', e) } } } })
      // v0.2: 更新上下文用量
      const estCu = msgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as VisionContent[]).reduce((t:number,p:VisionContent) => t + ((p as { text?: string }).text?.length || 0), 0) : 0), 0)
      set({ cu: estCu })
      window.huangquan.llm.chat({ requestId: rid, sid, provider: curP.type, model, apiKey: curP.apiKey, baseUrl: curP.baseUrl, messages: msgs, temperature: gSnap.temperature ?? 0.7, max_tokens: gSnap.maxTokens || undefined, tools: getActiveTools(), headers: curP.headers }).catch(e => { cbs.forEach(f => f()); reject(e) })
    })

  try {
    // 每次 LLM 调用独立超时保护 —— v0.2.3: 只中止当前请求(requestId), 不再误杀其他会话并发请求
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    // toolTimeout 设置接入 —— 默认 120s, 可在设置中调整
    const toolTimeout = Number(gSnap.toolTimeout) || 120000
    const guard = (rid: string) => { timeoutId = setTimeout(() => window.huangquan.llm.abort(rid), toolTimeout) }
    const clear = () => { if (timeoutId) clearTimeout(timeoutId) }

    // v0.2.1: 主执行循环 —— 正常轮次 + 插话补充轮次（工作中插话=补充指令，任务继续而非重开）
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
      // v0.2.1: 消费插话补充（第 2 轮起）—— 作为 user 消息注入，Agent 继续任务时可见
      if (roundNum > 1 && pendingInterject.some(x => x.sid === sid)) {
        const iidx = pendingInterject.findIndex(x => x.sid === sid)
        const inject = pendingInterject.splice(iidx, 1)[0].text
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: uuidv4(), role: 'user', content: inject, timestamp: Date.now() }] } : x) }))
      }

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
          catch (e) { lastErr = e; clear(); console.log('[MODEL] 视觉模型调用失败, 顺位下一个:', model, '->', String(e).slice(0, 120)); continue }
        }
        if (okRes) res = okRes
        else {
          res = { text: '', tcs: [] }
          const whyTxt = '所有视觉模型均调用失败：' + tried.join('、') + (lastErr ? '（' + String((lastErr as { message?: string })?.message || lastErr).slice(0, 150) + '）' : '')
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: '[识图失败] ' + whyTxt } : m) } : x) }))
          console.log('[MODEL] 视觉队列全部失败:', whyTxt)
          break // 跳出 while 主循环(本轮结束, 用户可见报错)
        }
      } else {
        res = await callLLM(aid, rid1); clear()
      }

      // 3. 工具调用循环（熔断+计时+重试+并行+单气泡整合）
      toolLog = []
      for (let r = 0; res.tcs.length > 0 && r < (gSnap.maxToolRounds || 50); r++) {
        // v0.3.1 D3: 长任务中途保存(每 5 轮或 30s, 走保存队列不阻塞)
        if (r > 0 && (r % 5 === 0 || Date.now() - lastMidSave > 30000)) {
          lastMidSave = Date.now()
          const curMs = get().sessions.find(x => x.id === sid)
          if (curMs) window.huangquan.sessions.save(curMs).catch(() => {})
        }
        // v0.2.1: 用户终止/插话 —— 任务代号失效则立即停止
        if (myGen !== getTaskGenFor(taskGenBySid, sid)) break
        // 熔断检测
        const meltLimit = gSnap.meltdownLimit || 3
        const rc = new Map(); for (const t of toolLog) { const k = t.name + '::' + JSON.stringify(t.args || {}); rc.set(k, (rc.get(k) || 0) + 1) }
        if (res.tcs.some((tc: ToolCallItem) => (rc.get(tc.name + '::' + JSON.stringify(tc.args || {})) || 0) >= meltLimit)) { console.warn('[黄泉Agent] 熔断'); break }

        set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: res.tcs.map((tc2: ToolCallItem) => ({ id: tc2.id, type: 'function', function: { name: tc2.name, arguments: JSON.stringify(tc2.args) } })) }]; return { sessions: s.sessions.map(x => x.id === sid ? cur : x) } })

        const maxRetry = gSnap.retryCount ?? 3
        const doParallel = gSnap.parallelTools !== false
        const doEpisodic = gSnap.episodicMemory !== false

        const runOne = async (tc: ToolCallItem) => { let r2 = '', ms = 0; for (let a = 0; a <= maxRetry; a++) { const t0 = Date.now(); // v0.2.3: 思考气泡显示「正在调用 XX」
          const argS = JSON.stringify(tc.args || {}); set({ stage: { sid, phase: 'tool', label: '🔧 ' + tc.name, detail: argS && argS.length > 40 ? argS.slice(0, 40) + '…' : (argS || '') } })
          r2 = await runTool(tc.name, tc.args, cfg); ms = Date.now() - t0; if (!r2.startsWith('E:')) break; if (a < maxRetry) await new Promise(r => setTimeout(r, 500)) } if (r2 && !r2.startsWith('E:')) setCached(tc.name + ':' + JSON.stringify(tc.args || {}), r2); toolLog.push({ name: tc.name, args: tc.args, result: r2, error: r2.startsWith('E:'), ms }); // v0.2.3: 完成后显示 ✓(带结果摘要)
        set({ stage: { sid, phase: 'tool', label: '✓ ' + tc.name, detail: (r2 && r2.length > 50 ? r2.slice(0, 50) + '…' : (r2 || '')) } })
        if (doEpisodic) recordEpisodic(tc.name, tc.args, r2).catch(() => {}); if (tc.name === 'handoff' && tc.args?.agent_name) { const to = String(tc.args.agent_name); const curAg = get().activeAgents || []; const maxChain = gSnap.maxHandoffChain || 3; if (!curAg.includes(to) && curAg.length >= maxChain) { return { tc, r: 'E:交接链已达上限(' + maxChain + '), 请在当前 Agent 直接完成任务, 不要再交接' } } set(s => ({ activeAgents: s.activeAgents.includes(to) ? s.activeAgents : [...s.activeAgents, to] })) }; return { tc, r: r2 } }
        const writes = ['write', 'edit', 'exec_command', 'mkdir', 'codebox']
        if (doParallel) {
          // 读类并行，写类串行；结果按 tc 一一对应收集，避免同名工具结果错配
          const readTcs = res.tcs.filter((tc: ToolCallItem) => !writes.includes(tc.name))
          const writeTcs = res.tcs.filter((tc: ToolCallItem) => writes.includes(tc.name))
          const results: { tc: ToolCallItem; r: string }[] = []
          const pResults = await Promise.all(readTcs.map(runOne))
          results.push(...pResults)
          for (const tc of writeTcs) { results.push(await runOne(tc)) }
          for (const { tc, r } of results) {
            set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'tool', content: r, timestamp: Date.now(), tool_call_id: tc.id }]; const entry = { id: uuidv4(), name: tc.name, args: tc.args, result: r, time: Date.now() }; return { sessions: s.sessions.map(x => x.id === sid ? cur : x), terminal: [...s.terminal, entry] } })
          }
        } else {
          for (const tc of res.tcs) { const { r } = await runOne(tc); set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'tool', content: r, timestamp: Date.now(), tool_call_id: tc.id }]; const entry = { id: uuidv4(), name: tc.name, args: tc.args, result: r, time: Date.now() }; return { sessions: s.sessions.map(x => x.id === sid ? cur : x), terminal: [...s.terminal, entry] } }) }
        }

        // v0.2.1: 工具执行中用户插话 → 补充立即注入（作为 user 消息），下一轮 LLM 可见
        while (pendingInterject.some(x => x.sid === sid) && myGen === getTaskGenFor(taskGenBySid, sid)) {
          const iidx2 = pendingInterject.findIndex(x => x.sid === sid)
          const inject = pendingInterject.splice(iidx2, 1)[0].text
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: uuidv4(), role: 'user', content: inject, timestamp: Date.now() }] } : x) }))
        }

        // v0.2.1: 多模型策略 —— 代码类任务切 codeModel，文档/总结类切 longTextModel
        const toolNames = res.tcs.map((tc: ToolCallItem) => tc.name)
        if (toolNames.some((n: string) => ['write', 'edit', 'exec_command', 'mkdir', 'codebox', 'grep', 'read'].includes(n))) {
          const cm = resolveModel('codeModel'); if (cm) { curP = cm.p; model = cm.model }
        } else if (toolNames.some((n: string) => ['summarize', 'save_memory', 'recall_memory', 'web_search', 'web_fetch', 'import_doc'].includes(n))) {
          const lm = resolveModel('longTextModel'); if (lm) { curP = lm.p; model = lm.model }
        }
        aid = uuidv4(); set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))
        const rid2 = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        guard(rid2)
        set({ stage: { sid, phase: 'thinking', label: '思考中', detail: '' } })
        if (myGen !== getTaskGenFor(taskGenBySid, sid)) { clear(); break } // 终止后不再发起下一轮 LLM
        res = await callLLM(aid, rid2); clear()
        if (myGen !== getTaskGenFor(taskGenBySid, sid)) break // 终止后丢弃本轮结果
      }

      // 4. 单气泡 + Hermes 风格日志
      set({ stage: null }) // v0.2.3: 任务完成, 思考气泡消失
      const finalSession = get().sessions.find(x => x.id === sid)
      if (finalSession) {
        // v0.2.1: 合并本轮所有 assistant 文本 → 单一气泡（工具循环中间轮的文字并入最终回复）
        // v0.3.1 D1: 清空边界 = 任务起始消息(userMsg.id 首次出现)之后的所有中间 assistant 文本(插话 user 消息不破坏边界)
    const lastUserIdx = finalSession.messages.map(m => m.id).indexOf(userMsg.id)
        const thisRound = lastUserIdx >= 0 ? finalSession.messages.slice(lastUserIdx) : finalSession.messages
        const midTexts = thisRound.filter(m => m.role === 'assistant' && m.content && m.id !== aid).map(m => m.content as string)
        const llmText = res.text || ''; const hasTools = toolLog.length > 0
        let finalContent = [ ...midTexts, llmText ].filter(Boolean).join('\n\n')
        // v0.2.3: 工具日志已改为写入右侧终端面板(terminal), 不再拼进消息正文(原死代码块已删除)
        // 中间轮 assistant 文本已并入最终气泡，清空其 content（UI 单气泡，API 上下文仍保留占位）
        // 只清空【本轮内】的中间 assistant 消息 —— 之前遍历整个会话导致历史回复全部被清空
        const roundIds = new Set(thisRound.map(m => m.id))
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => (roundIds.has(m.id) && m.role === 'assistant' && m.content && m.id !== aid) ? { ...m, content: '' } : (m.id === aid ? { ...m, content: finalContent, _toolLog: toolLog } : m)) } : x) }))
      }

      // v0.2.1: 有插话补充且未被终止 → 继续下一轮（任务不中断）
      if (myGen !== getTaskGenFor(taskGenBySid, sid) || pendingInterject.length === 0) break
    }

    // v0.2.3: 本任务总消耗 = sessTok 增量(含主 Agent 与全部子 Agent), 写到最后一条 assistant 消息
    try {
      const tokNow = get().sessTok[sid] || {}
      let taskTok = 0
      for (const [mk, c] of Object.entries(tokNow)) {
        const b = tokBase[mk]
        taskTok += (c.readTokens - (b?.readTokens || 0)) + (c.inputTokens - (b?.inputTokens || 0)) + (c.writeTokens - (b?.writeTokens || 0))
      }
      if (taskTok > 0) {
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map((m, idx) => {
          if (m.role === 'assistant') {
            let lastAi = -1
            for (let k = x.messages.length - 1; k >= 0; k--) if (x.messages[k].role === 'assistant') { lastAi = k; break }
            if (idx === lastAi) return { ...m, meta: { ...m.meta, taskTokens: taskTok } }
          }
          return m
        }) } : x) }))
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false, streaming: false, activeAgents: undefined } : x) }))
    set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: null, activeAgents: s.cid === sid ? [] : s.activeAgents }))
    // 任务结束瞬间发送的消息(走了插话分支但任务已退出)自动续跑 —— 解决"每个窗口只能发一次指令"
    // v0.3.1 C4: 会话级句柄(scheduleResume) + 触发前校验(代号未变 + 无新消息指纹)
    try {
      const ss2 = get().sessions.find(x => x.id === sid)
      if (ss2) {
        const msgs2 = ss2.messages
        let lu = -1, la = -1
        for (let k = msgs2.length - 1; k >= 0; k--) {
          if (msgs2[k].role === 'user' && lu < 0) lu = k
          if (msgs2[k].role === 'assistant' && la < 0) la = k
        }
        if (lu > la && lu >= 0 && !ss2.streaming && !get().executing) {
          const pm = msgs2[lu]
          const fp = (pm.content || '') + '|' + (pm.images || []).join('|')
          const now = Date.now()
          if (lastSendFp === fp && now - lastSendTs < 500) { /* 重复消息, 跳过续跑 */ }
          else {
            lastSendFp = fp; lastSendTs = now
            const sched = scheduleResume(ss2, () => {
              const cur2 = get().sessions.find(x => x.id === sid)
              if (!cur2) return
              const lu2 = (() => { for (let k = cur2.messages.length - 1; k >= 0; k--) if (cur2.messages[k].role === 'user') return k; return -1 })()
              const pm2 = lu2 >= 0 ? cur2.messages[lu2] : undefined
              const fp2 = ((pm2?.content || '') + '|' + (pm2?.images || []).join('|'))
              if (myGen === getTaskGenFor(taskGenBySid, sid) && fp2 === fp && !cur2.streaming) {
                get().send(pm2?.content || '', pm2?.images, pm2?.attachments).catch(() => {})
              }
            }, 300)
            set(s => ({ sessions: s.sessions.map(x => x.id === sid ? sched : x) }))
          }
        }
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
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
    // v0.2.1: 异常/插话中止时清理当前流式 assistant 残留（避免多气泡）
    try {
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsg?.id && !m.content ? { ...m, content: '' } : m) } : x) }))
    } catch (e) { /* 会话可能已删除 */ console.debug('[swallow]', e) }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
    set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: s.cid === sid ? friendly : s.error, stage: s.cid === sid ? null : s.stage, activeAgents: s.cid === sid ? [] : s.activeAgents }))
  } finally {
    // v0.3.0 FIX-B: 模型还原唯一入口 —— 只要真的切换过(switchedVision), 无论正常/异常/中断都还原主力模型
    if (switchedVision && origModel && origModel !== model) {
      curP = origP; model = origModel
      set({ curModel: model }); updateContextLimit(model)
      try { window.__lastModel = model || '' } catch (e) { /* ignore */ console.debug('[swallow]', e) }
      console.log('[MODEL] 视觉任务结束, 还原主力模型:', model)
    }
  }
}
