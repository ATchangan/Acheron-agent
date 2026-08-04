// src/store/resume-ops.ts —— 自动续跑(v0.3.1 补丁 D: 从 chat-send.ts 拆出, 行为零变化)
import { scheduleResume, getTaskGenFor } from './session-state'
import type { S } from './chat-send'

// send 幂等指纹(模块级, 串行入口安全)
let lastSendFp = ''; let lastSendTs = 0

// send 幂等去重: 同一内容 500ms 内重复发送返回 true(忽略)
export function checkSendIdempotent(fp: string): boolean {
  const now = Date.now()
  if (lastSendFp === fp && now - lastSendTs < 500) return true
  lastSendFp = fp; lastSendTs = now
  return false
}

export interface ResumeDeps {
  sid: string
  myGen: number
  taskGenBySid: Record<string, number>
  get: () => S
  set: (partial: S | Partial<S> | ((state: S) => S | Partial<S>), replace?: boolean) => void
}

// 任务结束瞬间发送的消息(走了插话分支但任务已退出)自动续跑 —— 解决"每个窗口只能发一次指令"
export function maybeAutoResume(deps: ResumeDeps): void {
  const { sid, myGen, taskGenBySid, get, set } = deps
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
}
