// electron/shared/patch-utils.ts — apply_patch 纯逻辑(与 Electron/IPC 解耦, 可单测)

export interface PatchHunk {
  oldText: string
  newText: string
}

export type PatchResult =
  | { ok: true; content: string }
  | { ok: false; errors: string[] }

// 按顺序对文件内容应用多个 hunk: 每个 oldText 必须唯一匹配, 失败时返回全部错误
export function applyPatchToContent(content: string, hunks: PatchHunk[]): PatchResult {
  let out = content
  const errors: string[] = []
  for (const h of hunks) {
    const oldText = String(h.oldText ?? '')
    if (!oldText) { errors.push('hunk 缺少 oldText'); continue }
    const first = out.indexOf(oldText)
    if (first < 0) { errors.push('未找到匹配片段: ' + oldText.slice(0, 40)); continue }
    if (out.indexOf(oldText, first + 1) >= 0) { errors.push('片段不唯一，请补充上下文: ' + oldText.slice(0, 40)); continue }
    out = out.slice(0, first) + String(h.newText ?? '') + out.slice(first + oldText.length)
  }
  return errors.length ? { ok: false, errors } : { ok: true, content: out }
}
