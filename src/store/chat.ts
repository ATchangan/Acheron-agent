import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { SessionData, SettingsData, ProviderConfig, SkillMeta, SessionMeta } from '../global'
import type { GeneralSettings } from '../types'
import { useSettingsStore } from './settings'
import { getModelContextLimit, updateContextLimit, buildPrompt } from './context'
import { refreshMemoryCache } from './memory'
import { invalidateSid } from './session-state'
import { clientSend, taskGenBySid } from './chat-send'
import { clearInterjectForSid } from './interject'
import type { S } from './chat-send'
import { bindEngineEvents } from './engine-client'

import { refreshMcpTools } from './mcp-tools'

// v0.3.0 M5: 工具调用循环中的扁平工具项(组件收集, 非 API delta)
interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
}
import { errMsg } from '../utils/safe'

// v0.3.3 性能优化: 已加载过全量消息的会话 id(启动只读 meta, 点开/切换才读全量)
const loadedSessionIds = new Set<string>()
const loadedOrder: string[] = [] // 最近打开顺序(最新在前)
const KEEP_LOADED_SESSIONS = 3 // 内存里最多保留 当前 + 最近 2 个已加载会话
const touchLoaded = (id: string): void => {
  const i = loadedOrder.indexOf(id)
  if (i >= 0) loadedOrder.splice(i, 1)
  loadedOrder.unshift(id)
}
// 释放久未访问的已加载会话消息(回到 meta 态), 再次点开时按需重读
const releaseRemoteSessions = (keepId: string): void => {
  const keep = new Set(loadedOrder.slice(0, KEEP_LOADED_SESSIONS))
  keep.add(keepId)
  const st = useChatStore.getState()
  for (const s of st.sessions) {
    if (!s.id || keep.has(s.id) || s.id === keepId) continue
    if (s.busy || s.streaming) continue
    if ((s.messages?.length || 0) > 0 && loadedSessionIds.has(s.id)) {
      loadedSessionIds.delete(s.id)
      useChatStore.setState(prev => ({ sessions: prev.sessions.map(x => x.id === s.id ? { ...x, messages: [] } : x) }))
    }
  }
}



// 安全序列化——防止 Proxy/循环引用导致 IPC 报错

// ─── v0.2: 渲染进程内置模块 ────────────────────────────
// 启动时预加载全局记忆
if (typeof window !== 'undefined' && window.huangquan?.memory) refreshMemoryCache().catch(() => {})
// v0.3.3: 启动时加载 MCP 工具清单(连接过的服务器 schema 直接并入 LLM 工具)
if (typeof window !== 'undefined') refreshMcpTools().catch(() => {})

// 简易工具缓存（避免 IPC 往返延迟）

// Token 估算（中英混合）

// ─── v0.2: 多角色编队（改用崩坏：星穹铁道角色命名，贴合黄泉旅途背景）───


// ─── v0.2: 模型上下文窗口自动检测 ──────────────────────

// 视觉辅助模型 —— 主模型不支持多模态时自动切换到视觉模型分析图片




export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, sp: '', spIshiki: '', streaming: false, executing: false, error: null, stage: null, terminal: [], cu: 0, cl: 65536, curModel: '', sessCache: {}, modelCache: {}, sessTok: {}, orphanTasks: [], planPending: {}, streamText: '', streamId: '',
  activeAgents: [],
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    if (!(window as unknown as { __engineBound?: boolean }).__engineBound) {
      ;(window as unknown as { __engineBound?: boolean }).__engineBound = true
      bindEngineEvents()
    }
    refreshMcpTools().catch(() => {})
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
    // v0.3.3 修复: 启动创建工作台走专用 mkdir IPC(L1 无确认), 不再触发 L2 风险弹窗
    if (wd) window.huangquan.computer.mkdir(wd).catch(() => {})
    // v0.3.3 性能优化: 启动只读会话元数据(标题/数量/模式), 消息懒加载
    const sessions: SessionData[] = metas.map((m: SessionMeta) => ({ id: m.id, title: m.title || '对话', messages: [], mode: m.mode || 'work', pinned: m.pinned === true }))
    for (const m of metas) {
      if (Number(m.messageCount || 0) === 0) loadedSessionIds.add(m.id)
    }
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
    loadedSessionIds.add(ns.id)
    // 清理历史空会话（按 meta.messageCount, 不再依赖已加载消息判断）
    // 置顶会话永久保留: 空会话清理跳过 pinned
    const staleIds = new Set(metas.filter(m => Number(m.messageCount || 0) === 0 && m.pinned !== true).map(m => m.id))
    for (const sid of staleIds) { window.huangquan.sessions.delete(sid).catch(() => {}) }
    const kept = sessions.filter(s => !staleIds.has(s.id))
    // maxSessions 设置接入 —— 超限时仅保留最新的 N 个会话(0=不限)
    const maxS = Number((cfg.general)?.maxSessions) || 0
    // 置顶会话永久保留: 不受数量上限裁剪, 永远排在列表最前
    let list = kept
    if (maxS > 0) {
      const pinnedS = kept.filter(s => s.pinned)
      const rest = kept.filter(s => !s.pinned)
      list = [...pinnedS, ...rest.slice(0, Math.max(0, maxS - pinnedS.length))]
    }
    list.unshift(ns)
    // v0.3.3: 恢复上次异常退出留下的运行中任务(任务队列在主进程落盘)
    const orphanTasks = (await window.huangquan.tasks.list().catch(() => []))
      .filter(t => t.status === 'running')
      .map(t => ({ id: t.id, sid: t.sid, content: t.content, images: t.images, attachments: t.attachments, at: t.startedAt }))
    set({ sessions: list, cid: ns.id, sp, orphanTasks })
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
      window.huangquan.sessions.save(ns)
      set({ sessions, cid: ns.id, sp, streamText: '', streamId: '' })
    } else {
      set({ sessions, cid: ms[0].id, sp, streamText: '', streamId: '' })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: '新对话', messages: [], mode: m }
    loadedSessionIds.add(ns.id)
    touchLoaded(ns.id)
    // 新会话独立,不继承其他会话的流式/执行状态
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id, streaming: false, executing: false, error: null, activeAgents: [], streamText: '', streamId: '' }))
    window.huangquan.sessions.save(ns)
  },
  switchS: async (id) => {
    // autoSave 设置接入 —— 切换会话前自动保存当前会话(autoSave !== false 时)
    const curId = get().cid
    if (curId && curId !== id && useSettingsStore.getState().general.autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    // 懒加载: 首次切到该会话才读全量消息(启动只加载了 meta)
    if (!loadedSessionIds.has(id)) {
      try {
        const full = await window.huangquan.sessions.load(id)
        loadedSessionIds.add(id)
        if (full && Array.isArray(full.messages)) {
          set(s => ({ sessions: s.sessions.map(x => x.id === id ? { ...x, messages: full.messages.filter(m => !(m as { _streaming?: boolean })._streaming), title: full.title || x.title, mode: full.mode || x.mode } : x) }))
        }
      } catch { loadedSessionIds.add(id) }
    }
    set(s => {
      // 切换会话时,全局 streaming/executing 跟随目标会话的忙碌状态（每个会话独立）
      const target = s.sessions.find(x => x.id === id)
      const busy = !!target?.busy
      // streamText 是"上一条流式"的临时通道, 切换会话必须清空, 防止串台
      return { cid: id, error: null, streamText: '', streamId: '', streaming: busy, executing: busy }
    })
    touchLoaded(id)
    releaseRemoteSessions(id)
  },
  del: (id) => {
    // 删除运行中的会话时同步停止主进程引擎任务, 避免后台空转消耗
    if (get().sessions.find(x => x.id === id)?.busy && window.huangquan?.engine) {
      window.huangquan.engine.stop(id).catch(() => {})
    }
    window.huangquan.sessions.delete(id)
    // 缓存命中统计永久保留 —— 删除历史会话不影响设置页统计(本地持久化)
    // 删除会话时同步清理关联运行时状态(磁盘文件已删; 内存 sessions 过滤 + 终端日志/活跃角色/插话队列)
    if (id === get().cid) clearInterjectForSid(id)
    loadedSessionIds.delete(id)
    const di = loadedOrder.indexOf(id)
    if (di >= 0) loadedOrder.splice(di, 1)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid, terminal: s.cid === id ? [] : s.terminal, activeAgents: s.cid === id ? [] : s.activeAgents } })
  },

  // 置顶/取消置顶 —— 置顶会话永久保留(不裁剪、不空清、排最前), 状态随会话文件持久化
  togglePin: (id: string) => {
    set(s => ({ sessions: s.sessions.map(x => x.id === id ? { ...x, pinned: !x.pinned } : x) }))
    const cur = get().sessions.find(x => x.id === id)
    if (cur) window.huangquan.sessions.save(cur).catch(() => {})
  },

  send: async (content, images, attachments?) => {
    await clientSend({ set, get }, content, images, attachments)
  },

  // v0.3.3: 恢复中断任务 —— 切到原会话(会话已删则新建)并重新发送
  restoreTask: async (id: string) => {
    const t = get().orphanTasks.find(x => x.id === id)
    if (!t) return
    let sid = t.sid
    if (!get().sessions.find(s => s.id === sid)) { get().create(); sid = get().cid! }
    else await get().switchS(sid)
    const rec = (await window.huangquan.tasks.list().catch(() => [])).find(x => x.id === id)
    set(s => ({ orphanTasks: s.orphanTasks.filter(x => x.id !== id) }))
    if (rec?.checkpoint) {
      await window.huangquan.engine.resume(id).catch(() => {})
    } else {
      // 无断点(启动前崩溃): 回退为重新发送原消息
      await get().send(t.content, t.images, t.attachments)
    }
  },


  // v0.3.1 C1: 停止仅作用于当前会话(会话级任务代号 + abort 带会话过滤)
  stop: () => {
    const sid = get().cid
    if (!sid) return
    window.huangquan.engine.stop(sid).catch(() => {})
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
