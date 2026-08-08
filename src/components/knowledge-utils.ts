// knowledge-utils.ts —— 藏书阁纯函数与常量（从 KnowledgeView 拆出，行为不变）
export interface DocMeta {
  name: string
  path: string
  importedAt: number
  size: number
}

// 检索命中：content 为命中的正文块，score 为相关度（0~1）
export interface SearchResult {
  content: string
  score: number
}

// 允许导入的格式
export const SUPPORTED_FORMATS = ['.txt', '.md', '.json', '.csv']
// 卷宗元数据在记忆中的标记前缀
export const DOC_TAG = '[doc]'

/* ─── helpers ─── */

export function fmtSize(bytes: number): string {
  if (bytes <= 0) return '未知'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

export function baseName(p: string): string {
  return p.split(/[/\\]/).pop() || p
}

export function parentDir(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/'
  const idx = p.lastIndexOf(sep)
  return idx > 0 ? p.slice(0, idx) : '.'
}

/* ─── inline styles ─── */


