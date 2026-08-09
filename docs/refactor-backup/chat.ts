import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage, SettingsData, UsageData, ProviderConfig, VisionContent, SkillMeta, SessionMeta, ToolCallDelta } from '../global'
import type { GeneralSettings } from '../types'
import { useSettingsStore } from './settings'
import { TOOLS } from './tools'
import { safeIPC } from '../utils/safe'
import { CACHE_TTL, WORKFLOWS } from './constants'
import { estimateTokens, getModelContextLimit, updateContextLimit, isVisionModel, buildPrompt, buildContextualMessages } from './context'
import { recordEpisodic, autoExtractMemory, refreshMemoryCache } from './memory'
import { routeAgent } from './router'
import { analyzeWithVision, buildVisionCandidates, runTool, getActiveTools, taskGen, nextTaskGen, costedReqs, setCached, getCached, onWriteOp } from './runtime'
import { normalizeImage } from '../utils/image'
import { refreshPluginTools } from './plugins'

// v0.3.0 M5: 工具调用循环中的扁平工具项(组件收集, 非 API delta)
interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
}
import { errMsg } from '../utils/safe'



// v0.2.1: 安全序列化——防止 Proxy/循环引用导致 IPC 报错

// ─── v0.2: 渲染进程内置模块 ────────────────────────────
// v0.2.3: 启动时预加载全局记忆
if (typeof window !== 'undefined' && window.huangquan?.memory) refreshMemoryCache().catch(() => {})
// v0.3.0 M4: 启动时加载插件工具(有 index.js 实现的插件并入 TOOLS)
if (typeof window !== 'undefined' && window.huangquan?.plugins) refreshPluginTools().catch(() => {})

// 简易工具缓存（避免 IPC 往返延迟）

// Token 估算（中英混合）

// ─── v0.2: 多Agent 编队（v0.2.1: 改用崩坏：星穹铁道角色命名，贴合黄泉旅途背景）───


// ─── v0.2: 模型上下文窗口自动检测 ──────────────────────

// v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时自动切换到视觉模型分析图片




interface S {
  sessions: SessionData[]; cid: string | null; sp: string; spIshiki: string; streaming: boolean; executing: boolean; error: string | null
  // v0.2.3: 执行阶段(思考中/工具调用) —— 用于思考气泡动态显示, 不写入消息流
  // v0.2.3-fix(Q5): 携带 sid —— 多会话并发时气泡只显示当前会话的阶段, 不串台
  stage: { sid: string; phase: 'thinking' | 'tool'; label: string; detail: string } | null
  terminal: { id: string; name: string; args: Record<string, unknown>; result: string; time: number }[]
  cu: number; cl: number
  // v0.2.6: 实时使用模型 + 按会话/按模型的缓存命中统计
  curModel: string
  sessCache: Record<string, { hits: number; misses: number }>
  modelCache: Record<string, { hits: number; misses: number }>
  // v0.2.6: 会话×模型的 TOKEN 缓存命中(前端镜像, 右侧面板实时显示)
  sessTok: Record<string, Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number }>>

  // v0.2.1: 多Agent 协作状态（当前正在调用的 Agent 集合，并发时多个同时显示）
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

// v0.2.1: 任务代号 —— stop()/插话使旧任务失效（token 递增），新任务持有新 token 不受影响(runtime.ts 持有)
// v0.2.1: 插话补充队列 —— 工作中插话=给当前任务补充指令，任务不中断，下一轮执行时注入
// v0.2.3-fix: 插话队列带会话归属 —— 多会话并发时插话只被本会话消费, 防串台
let pendingInterject: { sid: string; text: string }[] = []

export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, sp: '', spIshiki: '', streaming: false, executing: false, error: null, stage: null, terminal: [], cu: 0, cl: 65536, curModel: '', sessCache: {}, modelCache: {}, sessTok: {},
  activeAgents: [],
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    const [cfg, ishiki, metas, skills] = await Promise.all([
      window.huangquan.settings.load().catch(() => ({ providers: [] as ProviderConfig[], general: { mode: 'work', theme: 'dark' } } as SettingsData)),
      window.huangquan.ishiki.load().catch(() => ''),
      window.huangquan.sessions.list().catch(() => []),
      window.huangquan.skills.list().catch(() => []),
    ])
    const mode = cfg.general?.mode || 'work'
    const ss = skills.length ? '\n\n## 已装载技能\n' + skills.map((s: SkillMeta) => `- **${s.name}**: ${s.description}`).join('\n') : ''
    const sp = buildPrompt(mode, ishiki) + ss
    // v0.2.3: 独立保存原始 ishiki(不再从 sp 反推, 避免动态内容污染身份段)
    set({ spIshiki: ishiki })
    // 自动创建工作台目录（默认使用主进程 workspace 目录, v0.2.3: 不再硬编码用户路径）
    let wd = (cfg.general)?.workDir || ''
    if (!wd) {
      try { const paths = await window.huangquan.getPaths(); wd = paths?.workDir || '' } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      if (wd) useSettingsStore.getState().setWorkDir(wd)
    }
    if (wd) window.huangquan.computer.exec('if (-not (Test-Path "' + wd + '")) { New-Item -ItemType Directory -Path "' + wd + '" -Force }').catch(() => {})
    const sessions = await Promise.all(metas.map((m: SessionMeta) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: 'Chat', messages: [], mode: 'work' }))))
    // v0.2.3-fix: 启动巡检 —— 磁盘↔内存对账: 删除"磁盘存在但列表无归属"的孤立会话文件(删除会话未同步清理的孤儿消息)
    try {
      const diskIds: string[] = (await window.huangquan.sessions.audit?.()) || [] as string[]
      const storeIds = new Set<string>(sessions.map(s => s.id))
      for (const did of diskIds) {
        if (!storeIds.has(did)) { try { await window.huangquan.sessions.delete(did) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    // v0.2.1: 每次启动创建新的空会话（显示欢迎界面），历史会话保留在侧边栏供点击查看
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode }
    // v0.2.1: 清理历史空会话（从未发过消息的），避免启动多次后堆积垃圾文件
    const stale = sessions.filter(s => s.messages.length === 0)
    for (const s of stale) { window.huangquan.sessions.delete(s.id).catch(() => {}) }
    const kept = sessions.filter(s => s.messages.length > 0)
    kept.unshift(ns)
    // v0.2.3-fix(可用性): maxSessions 设置接入 —— 超限时仅保留最新的 N 个会话(0=不限)
    const maxS = Number((cfg.general)?.maxSessions) || 0
    set({ sessions: maxS > 0 ? kept.slice(0, maxS) : kept, cid: ns.id, sp })
  },

  setMode: async (m) => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ providers: [] as ProviderConfig[], general: { mode: 'work', theme: 'dark' } } as SettingsData))
    cfg.general.mode = m; await window.huangquan.settings.save(cfg)
    useSettingsStore.getState().load()
    const ishiki = await window.huangquan.ishiki.load().catch(() => '')
    const sp = buildPrompt(m, ishiki)
    const sessions = [...get().sessions]
    const ms = sessions.filter(s => (s.mode || 'work') === m)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
      sessions.unshift(ns)
      window.huangquan.sessions.save(safeIPC(ns))
      set({ sessions, cid: ns.id, sp })
    } else {
      set({ sessions, cid: ms[0].id, sp })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
    // v0.2.3: 新会话独立,不继承其他会话的流式/执行状态
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id, streaming: false, executing: false, error: null, activeAgents: [] }))
    window.huangquan.sessions.save(safeIPC(ns))
  },
  switchS: (id) => {
    // v0.2.3-fix(可用性): autoSave 设置接入 —— 切换会话前自动保存当前会话(autoSave !== false 时)
    const curId = get().cid
    if (curId && curId !== id && useSettingsStore.getState().general.autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    set(s => {
      // v0.2.3: 切换会话时,全局 streaming/executing 跟随目标会话的忙碌状态（每个会话独立）
      const target = s.sessions.find(x => x.id === id)
      const busy = !!target?.busy
      return { cid: id, error: null, streaming: busy, executing: busy }
    })
  },
  del: (id) => {
    window.huangquan.sessions.delete(id)
    // v0.2.6: 缓存命中统计永久保留 —— 删除历史会话不影响设置页统计(本地持久化)
    // v0.2.3-fix: 删除会话时同步清理关联运行时状态(磁盘文件已删; 内存 sessions 过滤 + 终端日志/活跃 Agent/插话队列)
    if (id === get().cid) pendingInterject = pendingInterject.filter(x => x.sid !== id)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid, terminal: s.cid === id ? [] : s.terminal, activeAgents: s.cid === id ? [] : s.activeAgents } })
  },

  send: async (content, images, attachments?) => {
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
    const myGen = nextTaskGen() // 本任务持有新代号；旧任务代号已失效
    // v0.2.3: 标记本会话为忙碌（侧栏"工作中"指示灯 + 独立并发）
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: true } : x) }))
    // v0.2: 插话模式下不重置 streaming，让 UI 平滑过渡
    const wasInterjecting = st0.streaming

    // v0.2.1: 多Agent 协作状态 —— 新任务开始时清空；handoff/自动路由不持久，恢复自动（仅用户手动选择保持固定）
    if (!wasInterjecting) {
      set({ activeAgents: [] })
      if (window.__huangquan_agent_manual !== true) delete window.__huangquan_agent
    }

    // 1. 获取 provider 和模型
    const cfg = await window.huangquan.settings.load()
    // v0.2.4: 任务配置快照 —— 任务执行期间用快照, 用户改设置不影响当前任务
    const gSnap = (cfg.general || {}) as GeneralSettings
    // v0.2.5-fix: 已配置供应商优先(原 providers[0] 可能无 key, 首个空配置会挡住对话)
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
    // 简单任务自动用快速模型（autoFastModel 开启且消息短/无图片时）—— v0.2.3-fix(P29): 词表扩充, 减少误判
    const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']
    const isSimple = gNow.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
    const fast = isSimple ? (resolveModel('fastModel') || main) : main
    // v0.2.4: 调度绑定（全局公用，含自定义模型）—— 轻量任务→小模型，复杂任务→大模型
    const small = resolveModel('smallModel')
    const large = resolveModel('largeModel')
    const chosen = isSimple ? (small || fast) : (large || main)
    let curP = chosen.p, model = chosen.model
    // v0.3.0-fix: 调度选择日志(定位切换失效问题)
    console.log('[MODEL] 选择:', model, '@', curP?.name || '?', '| 简单任务:', isSimple, '| 调度: 小=' + (small?.model || '-') + ' 大=' + (large?.model || '-') + ' 主=' + (main.model || '-'))
    set({ curModel: model || '' })
    // v0.2.4-debug: 暴露最近一次实际发送模型(验证调度绑定/多模型策略接线)
    try { window.__lastModel = model || '' } catch (e) { /* ignore */ console.debug('[swallow]', e) }
    updateContextLimit(model)

    // v0.2.1: 记录当前活跃 Agent（路由结果），供右侧面板展示
    const recordAgent = (name: string) => {
      set(s => ({ activeAgents: s.activeAgents.includes(name) ? s.activeAgents : [...s.activeAgents, name] }))
    }
    if (window.__huangquan_agent) recordAgent(window.__huangquan_agent)

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

    // 1. 追加用户消息到 store —— v0.2.3-fix: 立即上屏（不再等视觉分析，避免界面停留初始状态）
    // v0.2.3-fix: images 保留原始图片（聊天框 UI 显示）；API 是否传图由 withImages=isVisionModel(model) 决定
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
    // v0.2.2-fix: 无论视觉分析是否成功，主模型不支持视觉就不向 API 传图（否则 API 400: unknown variant image_url）
    // v0.2.3-fix: 用户消息已先上屏，分析完成后更新该消息 content（追加分析结果）
    // v0.3.0-fix: 视觉任务(发图/识图) —— 强制优先【视觉理解】队列模型(策略页配置, 按优先级), 队列空回退自动候选;
    //             调用失败自动顺位下一个; 全部失败清晰报错; 禁止纯文本模型处理图像
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
            content = content + '\n\n[图片未能分析：' + why + '。可在 设置→策略→目视觉理解 中配置视觉辅助模型优先级（如通义 qwen-vl、智谱 glm-4v、Kimi vision 等）。]'
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
        // v0.2.3-fix(P27): 工具参数解析失败不再完全静默 —— console.warn 便于排查
        cbs.push(window.huangquan.llm.onToolCall((tc: ToolCallDelta) => { if (tc && tc.requestId && tc.requestId !== rid) return; try { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { console.warn('[黄泉Agent] 工具参数解析失败:', tc?.function?.name, String(tc?.function?.arguments || '').slice(0, 100)) } }))
        const cur = get().sessions.find(x => x.id === sid)!
        const msgs = buildContextualMessages(cur.messages, isVisionModel(model), { gSnap, cl: get().cl, spIshiki: get().spIshiki, spFallback: get().sp, onAgentRoute: (role) => { if (role) set(s => ({ activeAgents: s.activeAgents.includes(role) ? s.activeAgents : [...s.activeAgents, role] })) } })
        // v0.2: 更新上下文用量
        const estCu = msgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as VisionContent[]).reduce((t:number,p:VisionContent) => t + ((p as { text?: string }).text?.length || 0), 0) : 0), 0)
        set({ cu: estCu })
        window.huangquan.llm.chat({ requestId: rid, provider: curP.type, model, apiKey: curP.apiKey, baseUrl: curP.baseUrl, messages: msgs, temperature: gSnap.temperature ?? 0.7, max_tokens: gSnap.maxTokens || undefined, tools: getActiveTools(), headers: curP.headers }).catch(e => { cbs.forEach(f => f()); reject(e) })
      })

    try {
      // 每次 LLM 调用独立超时保护 —— v0.2.3: 只中止当前请求(requestId), 不再误杀其他会话并发请求
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      // v0.2.3-fix(可用性): toolTimeout 设置接入 —— 默认 120s, 可在设置中调整
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
        if (myGen !== taskGen) break // 被终止
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
        // v0.3.0-fix: 视觉任务模型轮询 —— 调用失败自动顺位下一个视觉模型(队列优先级), 全部失败清晰报错
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
          // v0.2.1: 用户终止/插话 —— 任务代号失效则立即停止
          if (myGen !== taskGen) break
          // 熔断检测
          const meltLimit = gSnap.meltdownLimit || 3
          const rc = new Map(); for (const t of toolLog) { const k = t.name + '::' + JSON.stringify(t.args || {}); rc.set(k, (rc.get(k) || 0) + 1) }
          if (res.tcs.some((tc: ToolCallItem) => (rc.get(tc.name + '::' + JSON.stringify(tc.args || {})) || 0) >= meltLimit)) { console.warn('[黄泉Agent] 熔断'); break }

          set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: res.tcs.map((tc2: ToolCallItem) => ({ id: tc2.id, type: 'function', function: { name: tc2.name, arguments: JSON.stringify(tc2.args) } })) }]; return { sessions: s.sessions.map(x => x.id === sid ? cur : x) } })

          const maxRetry = gSnap.retryCount ?? 3
          const doParallel = gSnap.parallelTools !== false
          const doEpisodic = gSnap.episodicMemory !== false

          const runOne = async (tc: ToolCallItem) => { let r2 = '', ms = 0; for (let a = 0; a <= maxRetry; a++) { const t0 = Date.now(); // v0.2.3: 思考气泡显示「正在调用 XX」
            const argS = JSON.stringify(tc.args || {}); set({ stage: { sid, phase: 'tool', label: '工 ' + tc.name, detail: argS && argS.length > 40 ? argS.slice(0, 40) + '…' : (argS || '') } })
            r2 = await runTool(tc.name, tc.args, cfg); ms = Date.now() - t0; if (!r2.startsWith('E:')) break; if (a < maxRetry) await new Promise(r => setTimeout(r, 500)) } if (r2 && !r2.startsWith('E:')) setCached(tc.name + ':' + JSON.stringify(tc.args || {}), r2); toolLog.push({ name: tc.name, args: tc.args, result: r2, error: r2.startsWith('E:'), ms }); // v0.2.3: 完成后显示 ✓(带结果摘要)
          set({ stage: { sid, phase: 'tool', label: '✓ ' + tc.name, detail: (r2 && r2.length > 50 ? r2.slice(0, 50) + '…' : (r2 || '')) } })
          if (doEpisodic) recordEpisodic(tc.name, tc.args, r2).catch(() => {}); if (tc.name === 'handoff' && tc.args?.agent_name) { const to = String(tc.args.agent_name); const curAg = useChatStore.getState().activeAgents || []; const maxChain = gSnap.maxHandoffChain || 3; if (!curAg.includes(to) && curAg.length >= maxChain) { return { tc, r: 'E:交接链已达上限(' + maxChain + '), 请在当前 Agent 直接完成任务, 不要再交接' } } set(s => ({ activeAgents: s.activeAgents.includes(to) ? s.activeAgents : [...s.activeAgents, to] })) }; return { tc, r: r2 } }
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
          while (pendingInterject.some(x => x.sid === sid) && myGen === taskGen) {
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
          if (myGen !== taskGen) { clear(); break } // 终止后不再发起下一轮 LLM
          res = await callLLM(aid, rid2); clear()
          if (myGen !== taskGen) break // 终止后丢弃本轮结果
        }

        // 4. 单气泡 + 风格日志
        set({ stage: null }) // v0.2.3: 任务完成, 思考气泡消失
        const finalSession = get().sessions.find(x => x.id === sid)
        if (finalSession) {
          // v0.2.1: 合并本轮所有 assistant 文本 → 单一气泡（工具循环中间轮的文字并入最终回复）
          const lastUserIdx = finalSession.messages.map(m => m.id).lastIndexOf(userMsg.id)
          const thisRound = lastUserIdx >= 0 ? finalSession.messages.slice(lastUserIdx) : finalSession.messages
          const midTexts = thisRound.filter(m => m.role === 'assistant' && m.content && m.id !== aid).map(m => m.content as string)
          const llmText = res.text || ''; const hasTools = toolLog.length > 0
          let finalContent = [ ...midTexts, llmText ].filter(Boolean).join('\n\n')
          // v0.2.3: 工具日志已改为写入右侧终端面板(terminal), 不再拼进消息正文(原死代码块已删除)
          // 中间轮 assistant 文本已并入最终气泡，清空其 content（UI 单气泡，API 上下文仍保留占位）
          // v0.2.2-fix: 只清空【本轮内】的中间 assistant 消息 —— 之前遍历整个会话导致历史回复全部被清空
          const roundIds = new Set(thisRound.map(m => m.id))
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => (roundIds.has(m.id) && m.role === 'assistant' && m.content && m.id !== aid) ? { ...m, content: '' } : (m.id === aid ? { ...m, content: finalContent, _toolLog: toolLog } : m)) } : x) }))
        }

        // v0.2.1: 有插话补充且未被终止 → 继续下一轮（任务不中断）
        if (myGen !== taskGen || pendingInterject.length === 0) break
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
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
      set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: null, activeAgents: s.cid === sid ? [] : s.activeAgents }))
      // v0.2.3-fix: 任务结束瞬间发送的消息(走了插话分支但任务已退出)自动续跑 —— 解决"每个窗口只能发一次指令"
      try {
        const ss2 = get().sessions.find(x => x.id === sid)
        if (ss2) {
          const msgs2 = ss2.messages
          let lu = -1, la = -1
          for (let k = msgs2.length - 1; k >= 0; k--) {
            if (msgs2[k].role === 'user' && lu < 0) lu = k
            if (msgs2[k].role === 'assistant' && la < 0) la = k
          }
          if (lu > la && lu >= 0 && !get().streaming && !get().executing) {
            const pm = msgs2[lu]
            setTimeout(() => { get().send(pm.content || '', pm.images, pm.attachments).catch(() => {}) }, 300)
          }
        }
      } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      const toSave = get().sessions.find(x => x.id === sid)
      if (toSave) { window.huangquan.sessions.save(safeIPC(toSave)); autoExtractMemory(sid, get().sessions).catch(() => {}) }
    } catch (e: unknown) {
      const errText = (e instanceof Error ? e.message : String(e))
      // v0.3.0-fix: 栈溢出/异常友好化 —— 图片处理或模型调用异常时给出可操作提示, 不再裸抛
      const friendly = /maximum call stack|stack size|RangeError|too much recursion/i.test(errText)
        ? '处理任务时出现异常（可能是图片过大或模型调用过深）。建议：换较小的图片重试，或在 设置→策略 中检查视觉/主模型配置。' + (images?.length ? '（本次为图片任务）' : '')
        : errText
      // v0.2.2-fix: API 不接受 image_url 时（模型实际不支持视觉），移除图片后自动重试一次纯文本
      if (images?.length && /image_url|image url|image data/i.test(errText)) {
        console.warn('[黄泉Agent] 模型不支持图片，自动降级为纯文本重试:', errText.slice(0, 120))
        try {
          // v0.2.3-fix(P11): 简化 —— 直接按 userMsg.id 过滤, 消除冗余查找
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.filter(m => m.id !== userMsg?.id) } : x) }))
        } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
        set({ streaming: false, executing: false, error: null, activeAgents: [] })
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
  },

  stop: () => {
    nextTaskGen(); window.huangquan.llm.abort()
    // v0.2.3-fix(可用性): autoSave 设置接入 —— 停止时保存当前会话(部分回复不丢失)
    const curId = get().cid
    if (curId && useSettingsStore.getState().general?.autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    // v0.2.3: 停止时也清除当前会话忙碌标记
    if (curId) set(s => ({ sessions: s.sessions.map(x => x.id === curId ? { ...x, busy: false } : x) }))
    set({ streaming: false, executing: false, error: null })
  },

  // v0.2.2: 从指定用户消息重新发送（编辑后重发 / 刷新重发）
  resendFrom: async (msgId: string, newContent?: string) => {
    const s = get().cur(); if (!s || get().streaming) return
    const idx = s.messages.findIndex(m => m.id === msgId)
    if (idx < 0 || s.messages[idx].role !== 'user') return
    const lu = s.messages[idx]
    const msgs = s.messages.slice(0, idx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(newContent !== undefined ? newContent : (lu.content || ''), lu.images, lu.attachments)
  },
  regen: async () => {
    const s = get().cur(); if (!s || get().streaming) return
    // 找到最后一条用户消息的位置
    let lastUserIdx = -1
    for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'user') { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return
    const lu = s.messages[lastUserIdx]
    // 删除最后一条用户消息及之后的所有内容（send() 会重新添加用户消息）
    const msgs = s.messages.slice(0, lastUserIdx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(lu.content || '', lu.images)
  },
}))

export { updateContextLimit, getModelContextLimit } from './context'
