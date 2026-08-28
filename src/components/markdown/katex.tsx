// src/components/markdown/katex.tsx —— KaTeX 数学渲染(对齐 DSH renderTexToReact)
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

function renderTex(value: string, displayMode: boolean): string {
  try { return katex.renderToString(value, { displayMode, throwOnError: true }) }
  catch {
    try { return katex.renderToString(value, { displayMode, strict: 'ignore', throwOnError: false }) }
    catch { return `<span class="katex-error" style="color:#cc0000">${value}</span>` }
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
