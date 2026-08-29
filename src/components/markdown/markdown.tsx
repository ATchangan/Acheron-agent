// src/components/markdown/markdown.tsx —— v0.4.4 自研 mdast 渲染管线(真增量版)
// 解析: mdast-util-from-markdown + gfm(+ math 定稿), 数学兼容 TeX \\(...\\)/\\[...\\]
// 流式: 增量 StreamingRenderer —— 只重解析 text.slice(tailStart) 尾部、累积 frozen(源偏移稳定 key)、
//       只增量渲染新冻结块、按 text 幂等; 合并式脚注区; 安全链接(协议白名单+禁相对); 行内 code 恰为绝对URL→链接。
import { useMemo, useRef, type ReactNode } from 'react'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown } from 'mdast-util-math'
import type { Root, RootContent, Table, FootnoteDefinition } from 'mdast'
import { shiki } from './shiki'
import { MathBlock, InlineMath } from './katex'
import { cjkFriendlyStrong } from './cjk'

export const UNSTABLE_TAIL_BLOCKS = 2
type MDNode = RootContent

export interface FileMention { title: string; label: string; open: () => void }
export interface MarkdownOpts {
  streaming?: boolean
  copyLabel?: string
  copiedLabel?: string
  // fileMentions: 调用方注入的解析器(返回真实文件则渲染"打开文件"按钮)
  fileMentions?: { resolve: (value: string) => FileMention | undefined }
}

const valid = (b: MDNode): boolean => b.type !== 'definition' && b.type !== 'footnoteDefinition'

// ── 安全链接: new URL 协议白名单(http/https/mailto); 不安全/相对/片段锚点 → 纯文本 ──
function sanitizeUrl(url?: string): string {
  if (!url) return ''
  try {
    switch (new URL(url).protocol) {
      case 'http:': case 'https:': case 'mailto:': return url
      default: return ''
    }
  } catch { return '' }
}
function remoteImageUrl(url?: string): string | undefined {
  if (!url) return undefined
  try { return new URL(url).protocol === 'http:' || new URL(url).protocol === 'https:' ? url : undefined } catch { return undefined }
}
function inlineCodeHttpUrl(value: string): string | undefined {
  if (value.trim() !== value) return undefined
  try { return (new URL(value).protocol === 'http:' || new URL(value).protocol === 'https:') ? value : undefined } catch { return undefined }
}

// 轻量文件提及解析器(渲染端无同步 fs, 用启发式判断"像文件路径"; open 交给主进程 openFile)
export function fileMentionResolver(value: string): FileMention | undefined {
  if (!value) return undefined
  if (/\/|\\/.test(value) || /\.[a-z0-9]{1,8}$/i.test(value)) {
    return { title: value, label: value, open: () => { try { void (window as any).huangquan?.computer?.openFile?.(value).catch(() => {}) } catch { /* 忽略 */ } } }
  }
  return undefined
}

// ── 数学兼容(TeX 分隔符): \\[...\\]→$$..$$、\\(...\\)→$..$ (避免移植脆弱的 micromark tokenizer) ──
function mathCompatPreprocess(text: string): string {
  return text
    .replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$1$$$$')
    .replace(/\\\(([\s\S]*?)\\\)/g, '$$$1$$')
}

// ── 代码块: shiki 高亮(冻结块立即高亮; 流式尾部 lang 未定/增长中 → 不高亮) ──
function CodeBlock({ code, lang, streaming }: { code: string; lang?: string; streaming?: boolean }) {
  const html = streaming ? null : shiki.highlight(code, lang)
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code
  return (
    <div className={'md-code-block' + (lang ? ' md-code-block-lang' : '')}>
      <div className="md-code-banner">
        <span className="md-code-lang">{lang || (streaming ? '代码' : '')}</span>
        <button type="button" className="md-code-copy" onClick={() => void navigator.clipboard?.writeText(trimmed).catch(() => {})}>复制</button>
      </div>
      {html !== null
        ? <div className="md-code-body" dangerouslySetInnerHTML={{ __html: html }} />
        : <pre className="md-code-plain"><code>{trimmed}</code></pre>}
    </div>
  )
}

// ── 表格: 宽表(≥4 列)横向滚动 ──
function Table({ node }: { node: Table }) {
  const cols = node.children[0]?.children?.length || 0
  const wide = cols >= 4
  return (
    <div className={'md-table-scroll' + (wide ? ' md-table-wide' : ' md-table-fill')}>
      <table className="md-table">{renderTableChildren(node)}</table>
    </div>
  )
}
function renderTableChildren(node: Table) {
  return node.children.map((row, ri) => row.type === 'tableRow' ? (
    <tr key={ri}>{(row.children || []).map((cell, ci) => cell.type === 'tableCell' ? (ri === 0 ? <th key={ci} className="md-th">{renderChildren(cell.children)}</th> : <td key={ci} className="md-td">{renderChildren(cell.children)}</td>) : null)}</tr>
  ) : null)
}

function renderChildren(children: MDNode[], opts: MarkdownOpts = {}, footnotes?: FootnoteDefinition[]): ReactNode[] {
  return children.map((n, i) => renderNode(n, i, opts, footnotes))
}

function renderNode(node: MDNode, key: string | number, opts: MarkdownOpts, footnotes?: FootnoteDefinition[]): ReactNode {
  switch (node.type) {
    case 'paragraph': return <p key={key}>{renderChildren(node.children, opts, footnotes)}</p>
    case 'heading': {
      const Tag = ('h' + node.depth) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      return <Tag key={key} className={'md-h md-h' + node.depth}>{renderChildren(node.children, opts, footnotes)}</Tag>
    }
    case 'text': return <span key={key}>{node.value}</span>
    case 'break': return <br key={key} />
    case 'strong': return <strong key={key}>{renderChildren(node.children, opts, footnotes)}</strong>
    case 'emphasis': return <em key={key}>{renderChildren(node.children, opts, footnotes)}</em>
    case 'delete': return <del key={key}>{renderChildren(node.children, opts, footnotes)}</del>
    case 'inlineCode': {
      const value = node.value.replace(/\r?\n|\r/g, ' ')
      const href = inlineCodeHttpUrl(value)
      if (href !== undefined) return <code key={key} className="md-inline-code md-inline-url"><a href={href} target="_blank" rel="noreferrer noopener">{value}</a></code>
      const mention = (!opts.streaming && opts.fileMentions) ? opts.fileMentions.resolve(value) : undefined
      if (mention !== undefined) return <code key={key} className="md-inline-code"><button type="button" className="md-file-mention" title={mention.title} aria-label={mention.label} onClick={mention.open}>{value}</button></code>
      return <code key={key} className="md-inline-code" dir="ltr">{value}</code>
    }
    case 'code': return <CodeBlock key={key} code={node.value} lang={node.lang || undefined} streaming={opts.streaming} />
    case 'table': return <Table key={key} node={node} />
    case 'math': return <div key={key} className="md-math-block"><MathBlock value={node.value} /></div>
    case 'inlineMath': return <InlineMath key={key} value={node.value} />
    case 'blockquote': return <blockquote key={key} className="md-quote">{renderChildren(node.children, opts, footnotes)}</blockquote>
    case 'list': {
      const ordered = node.ordered
      const start = ordered && typeof node.start === 'number' && node.start !== 1 ? node.start : undefined
      const items = node.children.map((li, i) => {
        if (li.type !== 'listItem') return <li key={i} className="md-li" />
        const task = li.checked !== null && li.checked !== undefined
        const checkbox = task
          ? <span className="md-task"><input type="checkbox" readOnly checked={!!li.checked} disabled /></span>
          : null
        // 单段落项直接平铺进 li(复选框与文字同行, 消除块级 p 造成的两行断裂)
        const kids = li.children
        const first = kids[0]
        if (first && first.type === 'paragraph' && kids.length === 1) {
          return <li key={i} className="md-li">{checkbox}{renderChildren(first.children, opts, footnotes)}</li>
        }
        if (first && first.type === 'paragraph') {
          return (
            <li key={i} className="md-li">
              <p className="md-li-p">{checkbox}{renderChildren(first.children, opts, footnotes)}</p>
              {renderChildren(kids.slice(1), opts, footnotes)}
            </li>
          )
        }
        return <li key={i} className="md-li">{checkbox}{renderChildren(kids, opts, footnotes)}</li>
      })
      return ordered ? <ol key={key} start={start as number | undefined}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'thematicBreak': return <hr key={key} />
    case 'link': {
      const href = sanitizeUrl(node.url)
      if (href === '') return <span key={key}>{renderChildren(node.children, opts, footnotes)}</span>
      const isHttp = /^https?:/.test(href)
      return <a key={key} href={href} {...(isHttp ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{renderChildren(node.children, opts, footnotes)}</a>
    }
    case 'linkReference': return <span key={key}>{renderChildren(node.children, opts, footnotes)}</span>
    case 'image': {
      const src = remoteImageUrl(sanitizeUrl(node.url))
      if (src === undefined) return <span key={key} className="md-image-alt">{node.alt || ''}</span>
      return <img key={key} src={src} alt={node.alt || ''} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
    }
    case 'imageReference': return <span key={key} className="md-image-alt">{node.alt || ''}</span>
    case 'html': return <span key={key} className="md-html">{node.value}</span>
    case 'footnoteReference': {
      const id = node.identifier
      return <sup key={key} className="md-footnote"><a href={`#footnote-${id}`}>{id}</a></sup>
    }
    case 'definition': return null
    case 'footnoteDefinition': return null
    default: {
      const nd = node as unknown as { children?: MDNode[]; value?: string }
      if (nd.children) return <span key={key}>{renderChildren(nd.children, opts, footnotes)}</span>
      if (nd.value !== undefined) return <span key={key}>{nd.value}</span>
      return null
    }
  }
}

// ── 合并式脚注区: 收集 footnoteDefinition, 末尾渲染 ──
function FootnoteSection({ defs }: { defs: FootnoteDefinition[] }) {
  if (!defs.length) return null
  return (
    <section className="md-footnotes" data-footnotes>
      <hr className="md-footnotes-hr" />
      <ol>{defs.map((d) => (
        <li key={d.identifier} id={`footnote-${d.identifier}`} className="md-footnote-item">
          {renderChildren(d.children)} <a href={`#footnote-ref-${d.identifier}`} className="md-footnote-back">↩</a>
        </li>
      ))}</ol>
    </section>
  )
}

// ── 解析: 流式仅 GFM; 定稿 gfm+math(带 TeX 预处理) ──
function parseGfm(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm(), cjkFriendlyStrong()], mdastExtensions: [gfmFromMarkdown()] })
}
function parseGfmWithMath(text: string): Root {
  return fromMarkdown(mathCompatPreprocess(text), { extensions: [gfm(), cjkFriendlyStrong(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] })
}

// ── 块渲染 key: 源偏移(流式跨冻结边界稳定, React 复用不 remount) ──
function blockKey(node: MDNode, base: number, index: number): string {
  const offset = (node as { position?: { start?: { offset?: number } } }).position?.start?.offset
  return offset === undefined ? `-${index + 1}` : `${base + offset}`
}

// ── 真增量 StreamingRenderer: 累积 frozen + 只渲染新冻结块 + 幂等 ──
interface Frozen { node: MDNode; key: string }
class StreamingRenderer {
  private frozen: Frozen[] = []
  private frozenCount = 0
  private frozenEls: ReactNode[] = []
  private tailStart = 0
  private prevText = ''
  private lastText = ''
  private lastNodes: ReactNode[] = []
  constructor(private opts: MarkdownOpts) {}
  private renderBlocks(blocks: Frozen[], footnotes: FootnoteDefinition[]): ReactNode[] {
    return blocks.map(({ node, key }) => renderNode(node, key, this.opts, footnotes))
  }
  render(text: string): ReactNode[] {
    if (text === this.lastText) return this.lastNodes
    if (!text.startsWith(this.prevText)) { this.frozen = []; this.frozenCount = 0; this.frozenEls = []; this.tailStart = 0 }
    this.prevText = text
    const base = this.tailStart
    const root = parseGfm(text.slice(base))
    const blocks = root.children.filter(valid)
    const order = root.children.filter((b): b is FootnoteDefinition => b.type === 'footnoteDefinition')
    let firstUnstable = Math.max(0, blocks.length - UNSTABLE_TAIL_BLOCKS)
    if (firstUnstable > 0) {
      const cutEnd = (blocks[firstUnstable - 1] as { position?: { end?: { offset?: number } } }).position?.end?.offset
      if (cutEnd === undefined) firstUnstable = 0
      else {
        for (const node of blocks.slice(0, firstUnstable)) this.frozen.push({ node, key: blockKey(node, base, this.frozen.length) })
        this.tailStart = base + cutEnd
      }
    }
    const newlyFrozen = this.frozen.slice(this.frozenCount)
    if (newlyFrozen.length > 0) {
      const defs = order
      const batch = [...this.frozenEls]
      for (const el of this.renderBlocks(newlyFrozen, defs)) { if (batch.length > 0) batch.push('\n'); batch.push(el) }
      this.frozenEls = batch
      this.frozenCount = this.frozen.length
    }
    const tail = blocks.slice(firstUnstable).map((node, index) => ({ node, key: blockKey(node, base, index) }))
    const children = [...this.frozenEls]
    for (const el of this.renderBlocks(tail, order)) { if (children.length > 0) children.push('\n'); children.push(el) }
    // 合并脚注区(仅定稿信息稳定时; 流式放最后粗略显示)
    const defs = order
    if (defs.length > 0) children.push('\n', <FootnoteSection key="footnotes" defs={defs} />)
    this.lastText = text
    this.lastNodes = children
    return children
  }
}

// ── 对外: 流式正文(真增量) ──
export function StreamingMarkdown({ text, opts }: { text: string; opts: MarkdownOpts }) {
  const ref = useRef<StreamingRenderer | null>(null)
  const nodes = useMemo(() => {
    if (ref.current === null) ref.current = new StreamingRenderer({ ...opts, fileMentions: { resolve: fileMentionResolver } })
    return ref.current.render(text)
  }, [text])
  return <div className="md-root" data-streaming>{nodes}</div>
}

// ── 定稿: 一次解析(数学/高亮全量) ──
export function SettledMarkdown({ text, opts }: { text: string; opts: MarkdownOpts }) {
  const nodes = useMemo(() => {
    const root = parseGfmWithMath(text)
    const order = root.children.filter((b): b is FootnoteDefinition => b.type === 'footnoteDefinition')
    const main = root.children.filter(valid)
    const full: MarkdownOpts = { ...opts, fileMentions: { resolve: fileMentionResolver } }
    const out = renderChildren(main as MDNode[], full, order)
    if (order.length) out.push(<FootnoteSection key="footnotes" defs={order} />)
    return out
  }, [text])
  return <div className="md-root">{nodes}</div>
}
