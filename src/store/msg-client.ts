// src/store/msg-client.ts — 消息平台桥接(v0.4.4)
// 主进程 QQ 官方 Bot 收到消息 → 'msg:incoming' → 这里按联系人映射到专属会话,
// 走标准 send 流程; 会话由忙转闲时取最后一条助手回复, 经 msg:sendReply 发回 QQ(被动回复)。
// 模式参考 cron-client.ts: 主进程广播事件, 渲染层桥接到标准引擎管线。
import { useChatStore } from './chat'

const MAP_KEY = 'hq_msg_session_map'
// 联系人 → 会话 id 映射(本地持久化): {"qq:group:OPENID": "sid"}
type ContactMap = Record<string, string>
// 会话 → 最近一次来信上下文(回复路由用)
const replyCtx = new Map<string, { chatType: string; openid: string; msgId: string }>()
let initialized = false

const readMap = (): ContactMap => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}') } catch { return {} } }
const writeMap = (m: ContactMap): void => { try { localStorage.setItem(MAP_KEY, JSON.stringify(m)) } catch { /* 忽略 */ } }

const contactKey = (channel: string, chatType: string, openid: string): string => `${channel}:${chatType}:${openid}`

// 轻量 markdown → 纯文本(QQ msg_type 0)
function toPlainText(md: string): string {
  return String(md || '')
    .replace(/\r/g, '')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/^\s*[-*]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 800)
}

async function ensureSession(key: string, label: string): Promise<string> {
  const st = useChatStore.getState()
  const map = readMap()
  const known = map[key]
  if (known && st.sessions.some(s => s.id === known)) {
    if (st.cid !== known) await st.switchS(known)
    return known
  }
  st.create()
  const sid = useChatStore.getState().cid
  if (!sid) throw new Error('create session failed')
  useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, title: label, mode: 'work' } : x) }))
  const next = { ...readMap(), [key]: sid }
  writeMap(next)
  return sid
}

async function bridgeIncoming(r: { channel: string; chatType: string; openid: string; content: string; msgId: string }): Promise<void> {
  if (r.channel !== 'qq') return
  const key = contactKey(r.channel, r.chatType, r.openid)
  const label = 'QQ·' + (r.chatType === 'group' ? '群·' : '私·') + (r.openid.slice(-8) || '未知')
  try {
    const sid = await ensureSession(key, label)
    replyCtx.set(sid, { chatType: r.chatType, openid: r.openid, msgId: r.msgId })
    await useChatStore.getState().send(r.content)
  } catch (e) { console.debug('[msg-client]', e) }
}

// 会话忙→闲时回传最后一条助手回复
let prevBusy: Record<string, boolean> = {}
function drainReply(): void {
  const s = useChatStore.getState()
  const cur: Record<string, boolean> = {}
  for (const x of s.sessions) cur[x.id] = !!x.busy
  for (const sid of Object.keys(cur)) {
    if (!prevBusy[sid] || cur[sid]) continue
    const ctx = replyCtx.get(sid)
    if (!ctx) continue
    const sess = s.sessions.find(x => x.id === sid)
    let last = ''
    for (let i = (sess?.messages || []).length - 1; i >= 0; i--) {
      const m = (sess?.messages || [])[i]
      if (m.role === 'assistant' && m.content) { last = String(m.content); break }
    }
    if (!last) continue
    const text = toPlainText(last)
    if (!text) continue
    void window.huangquan.msg.sendReply({ channel: 'qq', chatType: ctx.chatType, openid: ctx.openid, msgId: ctx.msgId, text })
      .then(r => { if (!r?.ok) console.debug('[msg-client] 回复失败', r?.error) })
      .catch(() => {})
  }
  prevBusy = cur
}

export function initMsgClient(): void {
  if (initialized) return
  initialized = true
  try {
    window.huangquan.msg.onIncoming(r => { void bridgeIncoming(r) })
  } catch (e) { console.debug('[msg-client] init failed', e) }
  useChatStore.subscribe(() => { drainReply() })
}
