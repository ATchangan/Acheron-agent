// StreamMarkdown.tsx —— v0.4.2 流式 Markdown 渲染：
// Streamdown 流式渲染（不完整 Markdown 尾修复）+ 记忆化 KaTeX(单 $) + shiki 代码卡
// 排版：13px 正文 / 18px 行高 / 段落间距 0.7rem / 标题缩到聊天尺度 / 表格边框卡片
import { memo, useEffect, useMemo, useState, type ComponentProps } from 'react'
import { StreamdownTextPrimitive, tailBoundedRemend, type StreamdownTextComponents } from '@assistant-ui/react-streamdown'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { createMathPlugin } from '@streamdown/math'
import type { CodeHighlighterPlugin } from '@streamdown/code'
import 'katex/dist/katex.min.css'
import { openZoom } from './zoom'
import { useSettingsStore } from '../store/settings'
import { ErrorBoundary } from './ErrorBoundary'

const mathPlugin = createMathPlugin({ singleDollarTextMath: true })
const MAX_MARKDOWN_CHARS = 200_000

// shiki 代码插件延迟加载（避免主包体积暴涨）
let codePluginCache: CodeHighlighterPlugin | null = null
function useCodePlugin(): CodeHighlighterPlugin | null {
  const [plugin, setPlugin] = useState(codePluginCache)
  useEffect(() => {
    if (plugin) return
    let cancelled = false
    void import('@streamdown/code').then(m => {
      codePluginCache = m.code as CodeHighlighterPlugin
      if (!cancelled) setPlugin(codePluginCache)
    })
    return () => { cancelled = true }
  }, [plugin])
  return plugin
}

const HEADING_SIZES: Record<'h1' | 'h2' | 'h3' | 'h4', string> = {
  h1: '16px',
  h2: '15px',
  h3: '14px',
  h4: '13px',
}

const CONTAINER_CLASS = 'aui-md'

export const StreamMarkdown = memo(function StreamMarkdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const code = useCodePlugin()
  const mathRender = useSettingsStore(s => s.general.mathRender)
  const plugins = useMemo(() => ({
    ...(mathRender !== 'none' ? { math: mathPlugin } : {}),
    ...(code ? { code } : {}),
  }), [code, mathRender])

  const components = useMemo<StreamdownTextComponents>(() => ({
    h1: (props: ComponentProps<'h1'>) => <h1 className="my-1 font-semibold" style={{ fontSize: HEADING_SIZES.h1 }} {...props} />,
    h2: (props: ComponentProps<'h2'>) => <h2 className="my-1 font-semibold" style={{ fontSize: HEADING_SIZES.h2 }} {...props} />,
    h3: (props: ComponentProps<'h3'>) => <h3 className="my-1 font-semibold" style={{ fontSize: HEADING_SIZES.h3 }} {...props} />,
    h4: (props: ComponentProps<'h4'>) => <h4 className="my-1 font-semibold" style={{ fontSize: HEADING_SIZES.h4 }} {...props} />,
    p: (props: ComponentProps<'p'>) => <p className="overflow-wrap-anywhere leading-[1.5]" {...props} />,
    a: ({ href, ...props }: ComponentProps<'a'>) => (
      <a className="break-words overflow-wrap-anywhere" href={href} rel="noreferrer" target="_blank" {...props} />
    ),
    inlineCode: (props: ComponentProps<'code'>) => <code dir="ltr" {...props} />,
    hr: () => <div aria-hidden className="my-3" />,
    blockquote: ({ children, ...props }: ComponentProps<'blockquote'>) => (
      <blockquote className="hq-md-quote" {...props}>{children}</blockquote>
    ),
    ul: (props: ComponentProps<'ul'>) => <ul className="my-1 pl-5" {...props} />,
    ol: (props: ComponentProps<'ol'>) => <ol className="my-1 pl-5" {...props} />,
    li: (props: ComponentProps<'li'>) => <li className="leading-[1.5]" {...props} />,
    table: (props: ComponentProps<'table'>) => (
      <div className="hq-md-table my-2">
        <table className="hq-md-table-inner" {...props} />
      </div>
    ),
    thead: (props: ComponentProps<'thead'>) => <thead className="hq-md-thead" {...props} />,
    th: (props: ComponentProps<'th'>) => <th className="hq-md-th" {...props} />,
    td: (props: ComponentProps<'td'>) => <td className="hq-md-td" {...props} />,
    img: ({ src, alt, ...props }: ComponentProps<'img'>) => (
      <img
        {...props}
        src={src}
        alt={alt || '图片'}
        className="hq-zoomable hq-md-img"
        onClick={e => { e.preventDefault(); e.stopPropagation(); openZoom(String(src || '')) }}
      />
    ),
  }), [])

  // 超大内容(病态 Markdown/超长工具输出)直接降级为纯文本, 避免解析器卡死渲染进程
  if (content.length > MAX_MARKDOWN_CHARS) {
    return (
      <div className={CONTAINER_CLASS} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
        {content}
        {'\n\n[内容过长，已按纯文本显示]'}
      </div>
    )
  }
  return (
    <ErrorBoundary
      fallback={() => (
        <div className={CONTAINER_CLASS} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5 }}>
          {content}
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>[该消息渲染异常，已按纯文本显示]</div>
        </div>
      )}
    >
      <TextMessagePartProvider isRunning={streaming} text={content}>
        <StreamdownTextPrimitive
          mode="streaming"
          components={components}
          plugins={plugins}
          preprocess={t => { try { return tailBoundedRemend(t) } catch { return t } }}
          controls={{ code: true }}
          shikiTheme={['github-light-default', 'github-dark-dimmed']}
          containerClassName={CONTAINER_CLASS}
          defer
          lineNumbers={false}
        />
      </TextMessagePartProvider>
    </ErrorBoundary>
  )
})
