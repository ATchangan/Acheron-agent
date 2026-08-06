import React, { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { splitStreamMarkdown } from '../store/chat-view-utils'

// v0.3.3 性能优化: 流式 Markdown 增量渲染 —— 稳定前缀只解析一次,
// 只有尾部(块边界之后的小片段)随每个 chunk 重解析, 长回复不再越来越卡
const StableMd = memo(function StableMd({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
})

export default function StreamingMarkdown({ text }: { text: string }) {
  const { stable, tail } = splitStreamMarkdown(text)
  return (
    <>
      <StableMd text={stable} />
      {tail ? (
        <div className="stream-markdown-tail">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{tail}</ReactMarkdown>
        </div>
      ) : null}
    </>
  )
}
