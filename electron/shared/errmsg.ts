// electron/shared/errmsg.ts —— renderer/main 共享错误消息提取（B6-2）
// 约束：禁止 import electron API / zustand / fs

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
