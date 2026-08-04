// src/store/interject.ts —— 插话队列(v0.3.1 补丁 D2: 从 chat-send.ts 拆出, 行为零变化)
// 插话补充队列 —— 工作中插话=给当前任务补充指令，任务不中断，下一轮执行时注入
// 队列带会话归属 —— 多会话并发时插话只被本会话消费, 防串台
let pendingInterject: { sid: string; text: string }[] = []

export const clearInterjectForSid = (sid: string) => { pendingInterject = pendingInterject.filter(x => x.sid !== sid) }

export const pushInterject = (sid: string, text: string) => { pendingInterject.push({ sid, text }) }

export const hasInterjectForSid = (sid: string): boolean => pendingInterject.some(x => x.sid === sid)

// 消费本会话最早一条插话(返回 null 表示无)
export function drainInterjections(sid: string): string | null {
  const iidx = pendingInterject.findIndex(x => x.sid === sid)
  if (iidx < 0) return null
  return pendingInterject.splice(iidx, 1)[0].text
}
