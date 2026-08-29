// src/store/cron-client.ts — 定时任务触发客户端(v0.4.5 回归)
// 主进程调度器命中后广播 'cron:fire'; 这里确保存在「定时任务」会话, 并走标准 send 流程执行。
import { useChatStore } from './chat'

const CRON_SESSION_TITLE = '定时任务'

function ensureCronSession(): string {
  const st = useChatStore.getState()
  const existing = st.sessions.find(s => s.title === CRON_SESSION_TITLE)
  if (existing) {
    if (st.cid !== existing.id) void st.switchS(existing.id)
    return existing.id
  }
  st.create()
  const ns = useChatStore.getState().cur()
  if (ns) {
    useChatStore.setState(s => ({
      sessions: s.sessions.map(x => (x.id === ns.id ? { ...x, title: CRON_SESSION_TITLE } : x)),
    }))
    void window.huangquan.sessions.save({ ...ns, title: CRON_SESSION_TITLE }).catch(() => {})
    return ns.id
  }
  return st.cid as string
}

export function initCronClient(): void {
  try {
    window.huangquan.cron.onFire(({ prompt }) => {
      try {
        ensureCronSession()
        // 等切会话完成后再发送(switchS 是异步的)
        window.setTimeout(() => { void useChatStore.getState().send('[' + new Date().toLocaleString('zh-CN') + ' 定时任务]\n' + prompt, undefined) }, 300)
      } catch (e) { console.debug('[cron-client]', e) }
    })
  } catch (e) { console.debug('[cron-client] init failed', e) }
}
