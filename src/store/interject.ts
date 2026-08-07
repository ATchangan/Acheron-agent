// src/store/interject.ts —— 插话队列(v0.3.1 补丁 M1: 队列有界+合并+类型化)
// 插话补充队列 —— 工作中插话=给当前任务补充指令，任务不中断，下一轮执行时注入
// 队列带会话归属 —— 多会话并发时插话只被本会话消费, 防串台

// v0.3.1 M1: 插话类型 —— supplement=普通补充(可合并), retarget=改向指令(独立成项, 触发工具链熔断)
type InterjectKind = 'supplement' | 'retarget'
// v0.3.1 M1: 每会话队列上限(超限丢弃并统计)
export const MAX_INTERJECT_PER_SID = 20

// v0.3.1 M1: 改向关键词识别(含"别做了"等 → retarget)
const RETARGET_RE = /(别做|停止|重新来|换一个|不要.?继续|改做)/

export function detectInterjectKind(text: string): InterjectKind {
  return RETARGET_RE.test(text) ? 'retarget' : 'supplement'
}

let pendingInterject: { sid: string; text: string; kind: InterjectKind }[] = []
// v0.3.1 M1: 丢弃统计(有界上限触发时记录, 供调试观察)
let interjectDropCount = 0
export const getInterjectDropCount = () => interjectDropCount

export const clearInterjectForSid = (sid: string) => { pendingInterject = pendingInterject.filter(x => x.sid !== sid) }

// v0.3.1 M1: 合并规则 —— 同 sid 且同 kind 的 supplement 连续插入时合并为 1 条(text 以 \n 连接);
// retarget 永远独立成项; 队列超过 MAX_INTERJECT_PER_SID 时丢弃并统计
export const pushInterject = (sid: string, text: string, kind?: InterjectKind) => {
  const k = kind || detectInterjectKind(text)
  const perSid = pendingInterject.filter(x => x.sid === sid)
  if (perSid.length >= MAX_INTERJECT_PER_SID) { interjectDropCount++; return }
  const last = pendingInterject[pendingInterject.length - 1]
  if (k === 'supplement' && last && last.sid === sid && last.kind === 'supplement') {
    last.text = last.text + '\n' + text
    return
  }
  pendingInterject.push({ sid, text, kind: k })
}

export const hasInterjectForSid = (sid: string): boolean => pendingInterject.some(x => x.sid === sid)

// v0.3.1 M1: 查看本会话最早一条插话的 kind(不消费) —— 工具链熔断判定用
export function peekInterjectKind(sid: string): InterjectKind | null {
  const first = pendingInterject.find(x => x.sid === sid)
  return first ? first.kind : null
}

// 消费本会话最早一条插话(返回 null 表示无)
export function drainInterjections(sid: string): string | null {
  const iidx = pendingInterject.findIndex(x => x.sid === sid)
  if (iidx < 0) return null
  return pendingInterject.splice(iidx, 1)[0].text
}
