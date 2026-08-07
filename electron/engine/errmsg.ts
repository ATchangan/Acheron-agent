// electron/engine/errmsg.ts — 统一错误消息提取
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
