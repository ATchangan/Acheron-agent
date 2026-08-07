// skills-utils.ts —— 技能精神录纯函数与常量（从 SkillsView 拆出，行为不变）
import type { SkillMeta } from '../global'

export type Category = '工作流' | '提示词' | '知识' | '工具' | '自动化'

export interface SkillWithCategory extends SkillMeta {
  category: Category
}

export const CATEGORIES: Category[] = ['工作流', '提示词', '知识', '工具', '自动化']
export const CAT_ICON: Record<Category, string> = {
  '工作流': '🔄',
  '提示词': '💬',
  '知识': '📚',
  '工具': '🔧',
  '自动化': '⚡',
}
export const CAT_COLOR: Record<Category, string> = {
  '工作流': 'var(--accent)',
  '提示词': 'var(--accent-purple)',
  '知识': 'var(--success)',
  '工具': 'var(--warning)',
  '自动化': 'var(--danger)',
}

/* ─── 辅助函数 ────────────────────────────────────────── */

export function inferCategory(skill: SkillMeta): Category {
  const haystack = (skill.path + ' ' + skill.name + ' ' + (skill.description || '')).toLowerCase()
  if (/(?:workflow|工作流|flow|pipeline)/i.test(haystack)) return '工作流'
  if (/(?:prompt|提示词|提示|instruction)/i.test(haystack)) return '提示词'
  if (/(?:knowledge|知识|doc|wiki|rag)/i.test(haystack)) return '知识'
  if (/(?:tool|工具|util|helper)/i.test(haystack)) return '工具'
  if (/(?:auto|自动化|agent|cron|schedule)/i.test(haystack)) return '自动化'
  return '工作流'
}

export function buildSkillPath(name: string, category: Category): string {
  const slug = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '')
  const dir = CATEGORIES.indexOf(category) >= 0 ? category : '工作流'
  return `skills/${dir}/${slug}.md`
}

// 所有捕获组先 escapeHtml 再包标签 —— 修复 XSS(此前 heading/inline-code/link/img 原样注入)
export function renderMarkdown(src: string): string {
  let html = src
  const esc = escapeHtml
  /* fenced code blocks */
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    (_: string, lang: string, body: string) =>
      `<pre><code class="language-${esc(lang)}">${esc(body.trimEnd())}</code></pre>`)
  /* inline code */
  html = html.replace(/`([^`\n]+)`/g, (_m, c: string) => '<code>' + esc(c) + '</code>')
  /* headings */
  html = html.replace(/^#### (.+)$/gm, (_m, c: string) => '<h4>' + esc(c) + '</h4>')
  html = html.replace(/^### (.+)$/gm, (_m, c: string) => '<h3>' + esc(c) + '</h3>')
  html = html.replace(/^## (.+)$/gm, (_m, c: string) => '<h2>' + esc(c) + '</h2>')
  html = html.replace(/^# (.+)$/gm, (_m, c: string) => '<h1>' + esc(c) + '</h1>')
  /* bold + italic */
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, (_m, c: string) => '<strong><em>' + esc(c) + '</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, (_m, c: string) => '<strong>' + esc(c) + '</strong>')
  html = html.replace(/\*(.+?)\*/g, (_m, c: string) => '<em>' + esc(c) + '</em>')
  /* images —— 仅允许 http(s)/data: 协议, 其余丢弃 */
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src2: string) => {
    const s = src2.trim()
    return /^(https?:|data:image\/)/i.test(s) ? '<img alt="' + esc(alt) + '" src="' + esc(s) + '" />' : ''
  })
  /* links —— javascript:/data: 协议丢弃 */
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt: string, href: string) => {
    const h = href.trim()
    return /^(https?:|mailto:|#)/i.test(h) ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + '</a>' : esc(txt)
  })
  /* unordered lists */
  html = html.replace(/^[*-] (.+)$/gm, (_m, c: string) => '<li>' + esc(c) + '</li>')
  /* blockquote */
  html = html.replace(/^&gt; (.+)$/gm, (_m, c: string) => '<blockquote>' + esc(c) + '</blockquote>')
  /* horizontal rule */
  html = html.replace(/^---$/gm, '<hr />')
  /* paragraphs: double newline → <br/><br/> */
  html = html.replace(/\n\n/g, '<br/><br/>')
  return html
}

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/* ─── 组件 ───────────────────────────────────────────── */


