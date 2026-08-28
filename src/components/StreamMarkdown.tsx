// StreamMarkdown.tsx —— v0.4.4 换成 DSH 自研 mdast 渲染管线(取代 @assistant-ui/react-streamdown)
// 流式: 增量重渲染尾部(UNSTABLE_TAIL_BLOCKS=2); 定稿: 一次解析(带 KaTeX 数学 + shiki 高亮)
import { memo } from 'react'
import { StreamingMarkdown, SettledMarkdown, type MarkdownOpts } from './markdown/markdown'
import { ErrorBoundary } from './ErrorBoundary'

const MAX_MARKDOWN_CHARS = 200_000

export const StreamMarkdown = memo(function StreamMarkdown({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const opts: MarkdownOpts = { streaming }
  // 超大内容直接降级纯文本, 避免解析器卡死渲染进程
  if (content.length > MAX_MARKDOWN_CHARS) {
    return (
      <div className="md-md-plain" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'JetBrains Mono, Consolas, monospace', fontSize: 12, lineHeight: 1.6 }}>
        {content}
        {'\n\n[内容过长，已按纯文本显示]'}
      </div>
    )
  }
  return (
    <ErrorBoundary
      fallback={() => (
        <div className="md-md-plain" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 13, lineHeight: 1.5 }}>
          {content}
          <div style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 12 }}>[该消息渲染异常，已按纯文本显示]</div>
        </div>
      )}
    >
      {streaming ? <StreamingMarkdown text={content} opts={opts} /> : <SettledMarkdown text={content} opts={opts} />}
    </ErrorBoundary>
  )
})
