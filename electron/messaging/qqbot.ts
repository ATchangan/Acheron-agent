// electron/messaging/qqbot.ts — QQ 官方机器人接入（消息平台 · v0.4.4）
// 路线: QQ 开放平台官方 Bot(q.qq.com) — WebSocket 网关 + 被动回复
//  - token:  POST https://bots.qq.com/app/getAppAccessToken {appId, clientSecret} → access_token(约 2h)
//  - 网关:   GET  {api}/gateway/bot  (Authorization: QQBot <token>) → wss url
//  - 事件:   op 0 dispatch — GROUP_AT_MESSAGE_CREATE / C2C_MESSAGE_CREATE (intents 1<<25)
//  - 回复:   POST {api}/v2/groups/{group_openid}/messages 或 /v2/users/{openid}/messages
//            {content, msg_type:0, msg_id, msg_seq} —— 被动回复, 依赖消息 id(官方限制: 主动消息受限)
// 桥接: 收到消息 → 'msg:incoming' 广播给渲染层(建会话+走标准引擎流程);
//        渲染层拿到最终回复后调 msg:sendReply → 这里发回 QQ。
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'

export interface MsgConfig {
  enabled: boolean
  appId: string
  appSecret: string
  sandbox: boolean // 沙箱环境(q.qq.com 机器人测试)
  groupEnabled: boolean // 响应群聊 @ 消息
  c2cEnabled: boolean // 响应单聊消息
  /** v0.4.4 来信系统通知(设置→通知 可关; 默认开) */
  notifyMsgIncoming?: boolean
}

interface MsgContact {
  channel: 'qq'
  chatType: 'group' | 'c2c'
  openid: string
  msgId: string
  seq: number
}

const DEFAULT_CFG: MsgConfig = { enabled: false, appId: '', appSecret: '', sandbox: false, groupEnabled: true, c2cEnabled: true, notifyMsgIncoming: true }
const INTENTS = 1 << 25 // GROUP_AND_C2C_EVENT
let cfg: MsgConfig = { ...DEFAULT_CFG }
let dataFile = ''
let getSender: (() => Electron.WebContents | null) | null = null
let ws: WebSocket | null = null
let hbTimer: ReturnType<typeof setInterval> | null = null
let reconTimer: ReturnType<typeof setTimeout> | null = null
let lastSeq: number | null = null
let state: 'off' | 'connecting' | 'connected' | 'error' = 'off'
let stateDetail = ''

function load(): void {
  try { cfg = { ...DEFAULT_CFG, ...(JSON.parse(fs.readFileSync(dataFile, 'utf-8')) as Partial<MsgConfig>) } } catch { cfg = { ...DEFAULT_CFG } }
}
function save(): void {
  try { fs.mkdirSync(join(dataFile, '..'), { recursive: true }) } catch { /* 忽略 */ }
  fs.writeFileSync(dataFile, JSON.stringify(cfg, null, 2), 'utf-8')
}

function setState(s: typeof state, detail = ''): void {
  state = s
  stateDetail = detail
  try { getSender?.()?.send('msg:status', { channel: 'qq', state, detail }) } catch { /* 忽略 */ }
}

const apiBase = (): string => (cfg.sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com')

async function getAccessToken(): Promise<string> {
  const r = await fetch('https://bots.qq.com/app/getAppAccessToken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appId: cfg.appId, clientSecret: cfg.appSecret }),
  })
  const j = (await r.json()) as { access_token?: string; message?: string; code?: number }
  if (!j.access_token) throw new Error('获取 access_token 失败: ' + (j.message || JSON.stringify(j)).slice(0, 120))
  return j.access_token
}

function stopHeartbeat(): void {
  if (hbTimer) { clearInterval(hbTimer); hbTimer = null }
}

function closeWs(): void {
  stopHeartbeat()
  if (ws) { try { ws.onclose = null; ws.close(1000) } catch { /* 忽略 */ } ws = null }
  lastSeq = null
}

let connecting = false
async function connect(): Promise<void> {
  if (connecting || !cfg.enabled || !cfg.appId || !cfg.appSecret) return
  connecting = true
  closeWs()
  setState('connecting', '获取 access_token…')
  try {
    const token = await getAccessToken()
    const gr = await fetch(apiBase() + '/gateway/bot', { headers: { Authorization: 'QQBot ' + token } })
    const gj = (await gr.json()) as { url?: string; message?: string }
    if (!gj.url) throw new Error('获取网关失败: ' + (gj.message || '无 url').slice(0, 120))
    setState('connecting', '连接 WebSocket…')
    const socket = new WebSocket(gj.url)
    ws = socket
    socket.onmessage = (ev: MessageEvent) => { void onWsMessage(String(ev.data)) }
    socket.onclose = () => {
      stopHeartbeat()
      if (ws !== socket) return
      ws = null
      if (cfg.enabled) { setState('error', '连接断开，5s 后重连'); scheduleReconnect(5000) } else setState('off')
    }
    socket.onerror = () => { setState('error', 'WebSocket 错误') }
  } catch (e) {
    setState('error', String((e as Error).message || e).slice(0, 200))
    if (cfg.enabled) scheduleReconnect(15000)
  } finally {
    connecting = false
  }
}

function scheduleReconnect(ms: number): void {
  if (reconTimer) clearTimeout(reconTimer)
  reconTimer = setTimeout(() => { reconTimer = null; void connect() }, ms)
}

async function onWsMessage(raw: string): Promise<void> {
  let p: { op?: number; s?: number; t?: string; d?: Record<string, unknown> }
  try { p = JSON.parse(raw) } catch { return }
  if (p.op === 10) {
    // Hello → identify + 定时心跳
    const interval = Number((p.d as { heartbeat_interval?: number })?.heartbeat_interval || 30000)
    const token = await getAccessToken().catch(() => '')
    if (!token || !ws || ws.readyState !== 1) { setState('error', 'identify 前 token 获取失败'); return }
    ws.send(JSON.stringify({ op: 2, d: { token: 'QQBot ' + token, intents: INTENTS, shard: [0, 1] } }))
    stopHeartbeat()
    hbTimer = setInterval(() => {
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ op: 1, d: lastSeq }))
    }, Math.max(5000, interval - 2000))
    return
  }
  if (p.op === 11) return // 心跳 ACK
  if (p.op === 0 && typeof p.s === 'number') lastSeq = p.s
  if (p.op === 0 && p.t && p.d) dispatchEvent(String(p.t), p.d)
}

function dispatchEvent(t: string, d: Record<string, unknown>): void {
  const content = String(d.content || '').trim()
  if (!content) return
  // v0.4.4: 来信系统通知(设置→通知 可关; 默认开)
  if (cfg.notifyMsgIncoming !== false) {
    try {
      const { Notification } = require('electron') as typeof import('electron')
      new Notification({ title: 'QQ 新消息', body: content.slice(0, 80), silent: false }).show()
    } catch { /* 通知失败不影响消息 */ }
  }
  if (t === 'GROUP_AT_MESSAGE_CREATE' && cfg.groupEnabled) {
    const groupOpenid = String(d.group_openid || '')
    const msgId = String(d.id || '')
    if (!groupOpenid || !msgId) return
    setState('connected')
    try { getSender?.()?.send('msg:incoming', { channel: 'qq', chatType: 'group', openid: groupOpenid, content, msgId, ts: Date.now() }) } catch { /* 忽略 */ }
    return
  }
  if (t === 'C2C_MESSAGE_CREATE' && cfg.c2cEnabled) {
    const userOpenid = String((d.author as { user_openid?: string })?.user_openid || d.user_openid || '')
    const msgId = String(d.id || '')
    if (!userOpenid || !msgId) return
    setState('connected')
    try { getSender?.()?.send('msg:incoming', { channel: 'qq', chatType: 'c2c', openid: userOpenid, content, msgId, ts: Date.now() }) } catch { /* 忽略 */ }
  }
}

const seqByMsgId = new Map<string, number>()
async function reply(contact: MsgContact, text: string): Promise<{ ok: boolean; error?: string }> {
  const content = String(text || '').trim().slice(0, 800) || '（无内容）'
  try {
    const token = await getAccessToken()
    const seq = (seqByMsgId.get(contact.msgId) || 0) + 1
    seqByMsgId.set(contact.msgId, seq)
    const path = contact.chatType === 'group'
      ? apiBase() + '/v2/groups/' + encodeURIComponent(contact.openid) + '/messages'
      : apiBase() + '/v2/users/' + encodeURIComponent(contact.openid) + '/messages'
    const r = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'QQBot ' + token },
      body: JSON.stringify({ content, msg_type: 0, msg_id: contact.msgId, msg_seq: seq }),
    })
    const j = (await r.json().catch(() => ({}))) as { message?: string; code?: number }
    if (!r.ok) return { ok: false, error: 'QQ 回复失败(' + r.status + '): ' + String(j.message || '').slice(0, 120) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e).slice(0, 160) }
  }
}

export function startMessaging(): void {
  if (cfg.enabled) void connect()
}

export function stopMessaging(): void {
  cfg.enabled = false
  closeWs()
  setState('off')
}

export function registerMessagingIpc(deps: { dataFile: string; getSender: () => Electron.WebContents | null }): void {
  dataFile = deps.dataFile
  getSender = deps.getSender
  load()
  ipcMain.handle('msg:getConfig', () => ({ config: { ...cfg }, state, detail: stateDetail }))
  ipcMain.handle('msg:setConfig', (_e, patch: Partial<MsgConfig>) => {
    const prevEnabled = cfg.enabled
    cfg = { ...cfg, ...patch }
    save()
    if (cfg.enabled && (!prevEnabled || state === 'off' || state === 'error')) { setState('connecting', '启动连接…'); void connect() }
    if (!cfg.enabled) stopMessaging()
    return true
  })
  ipcMain.handle('msg:sendReply', (_e, payload: MsgContact & { text: string }) => reply(payload, payload.text))
  if (cfg.enabled) void connect()
}
