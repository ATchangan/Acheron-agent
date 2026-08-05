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
import { nextTaskGenFor, getTaskGenFor, invalidateSid, scheduleResume, cancelResume } from './session-state'
import { runSend, taskGenBySid } from './chat-send'
import { clearInterjectForSid } from './interject'
import type { S } from './chat-send'

import { refreshPluginTools } from './plugins'

// v0.3.0 M5: 工具调用循环中的扁平工具项(组件收集, 非 API delta)
interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
}
import { errMsg } from '../utils/safe'



// 安全序列化——防止 Proxy/循环引用导致 IPC 报错

// ─── v0.2: 渲染进程内置模块 ────────────────────────────
// 启动时预加载全局记忆
if (typeof window !== 'undefined' && window.huangquan?.memory) refreshMemoryCache().catch(() => {})
// v0.3.0 M4: 启动时加载插件工具(有 index.js 实现的插件并入 TOOLS)
if (typeof window !== 'undefined' && window.huangquan?.plugins) refreshPluginTools().catch(() => {})

// 简易工具缓存（避免 IPC 往返延迟）

// Token 估算（中英混合）

// ─── v0.2: 多Agent 编队（改用崩坏：星穹铁道角色命名，贴合黄泉旅途背景）───


// ─── v0.2: 模型上下文窗口自动检测 ──────────────────────

// 视觉辅助模型 —— 主模型不支持多模态时自动切换到视觉模型分析图片




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
    // 独立保存原始 ishiki(不再从 sp 反推, 避免动态内容污染身份段)
    set({ spIshiki: ishiki })
    // 自动创建工作台目录（默认使用主进程 workspace 目录, 不再硬编码用户路径）
    let wd = (cfg.general)?.workDir || ''
    if (!wd) {
      try { const paths = await window.huangquan.getPaths(); wd = paths?.workDir || '' } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      if (wd) useSettingsStore.getState().setWorkDir(wd)
    }
    if (wd) window.huangquan.computer.exec('if (-not (Test-Path "' + wd + '")) { New-Item -ItemType Directory -Path "' + wd + '" -Force }').catch(() => {})
    const sessions = await Promise.all(metas.map((m: SessionMeta) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: '对话', messages: [], mode: 'work' }))))
    // 启动巡检 —— 磁盘↔内存对账: 删除"磁盘存在但列表无归属"的孤立会话文件(删除会话未同步清理的孤儿消息)
    try {
      const diskIds: string[] = (await window.huangquan.sessions.audit?.()) || [] as string[]
      const storeIds = new Set<string>(sessions.map(s => s.id))
      for (const did of diskIds) {
        if (!storeIds.has(did)) { try { await window.huangquan.sessions.delete(did) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) } }
      }
    } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    // 每次启动创建新的空会话（显示欢迎界面），历史会话保留在侧边栏供点击查看
    const ns: SessionData = { id: uuidv4(), title: '新对话', messages: [], mode }
    // 清理历史空会话（从未发过消息的），避免启动多次后堆积垃圾文件
    const stale = sessions.filter(s => s.messages.length === 0)
    for (const s of stale) { window.huangquan.sessions.delete(s.id).catch(() => {}) }
    const kept = sessions.filter(s => s.messages.length > 0)
    kept.unshift(ns)
    // maxSessions 设置接入 —— 超限时仅保留最新的 N 个会话(0=不限)
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
      const ns: SessionData = { id: uuidv4(), title: '新对话', messages: [], mode: m }
      sessions.unshift(ns)
      window.huangquan.sessions.save(safeIPC(ns))
      set({ sessions, cid: ns.id, sp })
    } else {
      set({ sessions, cid: ms[0].id, sp })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: '新对话', messages: [], mode: m }
    // 新会话独立,不继承其他会话的流式/执行状态
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id, streaming: false, executing: false, error: null, activeAgents: [] }))
    window.huangquan.sessions.save(safeIPC(ns))
  },
  switchS: (id) => {
    // autoSave 设置接入 —— 切换会话前自动保存当前会话(autoSave !== false 时)
    const curId = get().cid
    if (curId && curId !== id && useSettingsStore.getState().general.autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    set(s => {
      // 切换会话时,全局 streaming/executing 跟随目标会话的忙碌状态（每个会话独立）
      const target = s.sessions.find(x => x.id === id)
      const busy = !!target?.busy
      return { cid: id, error: null, streaming: busy, executing: busy }
    })
  },
  del: (id) => {
    window.huangquan.sessions.delete(id)
    // 缓存命中统计永久保留 —— 删除历史会话不影响设置页统计(本地持久化)
    // 删除会话时同步清理关联运行时状态(磁盘文件已删; 内存 sessions 过滤 + 终端日志/活跃 Agent/插话队列)
    if (id === get().cid) clearInterjectForSid(id)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid, terminal: s.cid === id ? [] : s.terminal, activeAgents: s.cid === id ? [] : s.activeAgents } })
  },

  send: async (content, images, attachments?) => {
    await runSend({ set, get }, content, images, attachments)
  },


  // v0.3.1 C1: 停止仅作用于当前会话(会话级任务代号 + abort 带会话过滤)
  stop: () => {
    const sid = get().cid
    if (!sid) return
    invalidateSid(taskGenBySid, sid)          // 只杀当前会话
    window.huangquan.llm.abort(sid)            // abort 带会话过滤
    const cur = get().sessions.find(x => x.id === sid)
    if (cur) { clearTimeout(cur.resumeTimer) }
    if (cur && useSettingsStore.getState().general?.autoSave !== false) {
      window.huangquan.sessions.save({ ...cur, busy: false, streaming: false, resumeTimer: undefined }).catch(() => {})
    }
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false, streaming: false, resumeTimer: undefined } : x) }))
    set({ executing: false, error: null })
  },

  // 从指定用户消息重新发送（编辑后重发 / 刷新重发）
  resendFrom: async (msgId: string, newContent?: string) => {
    const s = get().cur(); if (!s || s.streaming) return // v0.3.1 C6: 本会话忙判断
    const idx = s.messages.findIndex(m => m.id === msgId)
    if (idx < 0 || s.messages[idx].role !== 'user') return
    const lu = s.messages[idx]
    const msgs = s.messages.slice(0, idx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(newContent !== undefined ? newContent : (lu.content || ''), lu.images, lu.attachments)
  },
  regen: async () => {
    const s = get().cur(); if (!s || s.streaming) return // v0.3.1 C6: 本会话忙判断
    // 找到最后一条用户消息的位置
    let lastUserIdx = -1
    for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'user') { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return
    const lu = s.messages[lastUserIdx]
    // 删除最后一条用户消息及之后的所有内容（send() 会重新添加用户消息）
    const msgs = s.messages.slice(0, lastUserIdx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(lu.content || '', lu.images, lu.attachments) // v0.3.1 C5: 补 attachments(附件描述不丢)
  },
}))

export { updateContextLimit, getModelContextLimit } from './context'
