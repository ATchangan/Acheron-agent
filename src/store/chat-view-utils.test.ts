import { describe, expect, it } from 'vitest'
import { isNearBottom, latestAssistantText, splitStreamMarkdown } from './chat-view-utils'

describe('isNearBottom', () => {
  it('接近底部时返回 true', () => {
    expect(isNearBottom(800, 1200, 300)).toBe(true) // 剩余 100px < 160
  })

  it('离开底部时返回 false', () => {
    expect(isNearBottom(500, 1200, 300)).toBe(false) // 剩余 400px > 160
  })

  it('不可滚动容器(高度 0)视为已贴底', () => {
    expect(isNearBottom(0, 0, 0)).toBe(true)
  })

  it('支持自定义阈值', () => {
    expect(isNearBottom(700, 1200, 300, 300)).toBe(true)
    expect(isNearBottom(700, 1200, 300, 100)).toBe(false)
  })
})

describe('latestAssistantText', () => {
  it('优先取最终回复(assistant 无 tool_calls 有内容), 跳过步骤卡', () => {
    const msgs = [
      { role: 'assistant', content: '先读取文件', tool_calls: [{ id: '1' }] },
      { role: 'tool', content: 'ok' },
      { role: 'assistant', content: '**这是最终回复**', tool_calls: undefined },
    ]
    expect(latestAssistantText(msgs)).toBe('**这是最终回复**')
  })

  it('无最终回复时回退到流式文字', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '步骤说明', tool_calls: [{ id: '1' }] },
    ]
    expect(latestAssistantText(msgs, '正在流式输出…')).toBe('正在流式输出…')
  })

  it('无流式文字时回退到最后一条 assistant 步骤说明', () => {
    const msgs = [
      { role: 'assistant', content: '步骤说明', tool_calls: [{ id: '1' }] },
    ]
    expect(latestAssistantText(msgs)).toBe('步骤说明')
  })

  it('忽略用户/工具消息与空内容', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   ' },
      { role: 'tool', content: 'result' },
    ]
    expect(latestAssistantText(msgs)).toBe('')
    expect(latestAssistantText(msgs, '')).toBe('')
  })
})

describe('splitStreamMarkdown', () => {
  it('按最后一个空行切分: 完整段落进稳定区, 尾部保留', () => {
    const text = '第一段完成。\n\n第二段开头 **还在流**'
    const { stable, tail } = splitStreamMarkdown(text)
    expect(stable).toBe('第一段完成。')
    expect(tail).toContain('第二段')
    expect(stable + tail).toBe(text)
  })

  it('没有空行时按最后一个换行切分', () => {
    const text = 'line1\nline2\nline3-partial'
    const { stable, tail } = splitStreamMarkdown(text)
    expect(stable).toBe('line1\nline2')
    expect(tail).toBe('\nline3-partial')
  })

  it('单段超长文本(无换行)整体走尾部, 稳定区为空', () => {
    const text = 'a'.repeat(5000)
    const { stable, tail } = splitStreamMarkdown(text)
    expect(stable).toBe('')
    expect(tail).toBe(text)
  })

  it('未闭合代码围栏回退到围栏起点', () => {
    const text = '说明\n\n```js\nconst x = 1\n'
    const { stable, tail } = splitStreamMarkdown(text)
    // 空行边界已在围栏前, 围栏整体留在尾部(未闭合时前缀不吞代码块)
    expect(stable).toBe('说明')
    expect(tail).toBe('\n\n```js\nconst x = 1\n')
  })

  it('已闭合围栏正常留在稳定区', () => {
    const text = '说明\n\n```js\nconst x = 1\n```\n\n后续正文开始'
    const { stable, tail } = splitStreamMarkdown(text)
    expect(stable).toContain('```js')
    expect(tail).toContain('后续正文')
  })
})
