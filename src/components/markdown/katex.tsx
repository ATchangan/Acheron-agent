// src/components/markdown/katex.tsx —— KaTeX 数学渲染
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

// 安全: 兜底路径内插进 innerHTML 前必须转义(模型可控的原始 LaTeX 可能携带 HTML)
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

function renderTex(value: string, displayMode: boolean): string {
  try { return katex.renderToString(value, { displayMode, throwOnError: true }) }
  catch {
    try { return katex.renderToString(value, { displayMode, strict: 'ignore', throwOnError: false }) }
    catch { return `<span class="katex-error" style="color:#cc0000">${escapeHtml(value)}</span>` }
  }
}

export function MathBlock({ value }: { value: string }) {
  const html = useMemo(() => renderTex(value, true), [value])
  return <div className="md-katex-display" dangerouslySetInnerHTML={{ __html: html }} />
}

export function InlineMath({ value }: { value: string }) {
  const html = useMemo(() => renderTex(value, false), [value])
  return <span className="md-katex-inline" dangerouslySetInnerHTML={{ __html: html }} />
}
