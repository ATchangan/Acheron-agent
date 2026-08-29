// ConversationThread 渲染冒烟测试 — 无头验证活动行栈(v0.6.0 参考风格工具分组)逻辑
// @ts-nocheck
import { describe, it, expect, beforeAll } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'

// node 环境垫片(组件渲染期会触达)
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.localStorage) {
    g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  }
  if (!g.window) {
    g.window = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
    ;(g.window as unknown as Record<string, unknown>).localStorage = g.localStorage
  }
})

import { ConversationTurn } from './ConversationThread'

type Msg = Record<string, unknown>
const msg = (over: Msg): Msg => ({ id: 'm' + Math.random().toString(36).slice(2), role: 'assistant', content: '', timestamp: Date.now(), ...over })
const toolCall = (name: string, id: string): Msg => ({ id, type: 'function', function: { name, arguments: '{}' } })

describe('活动行栈(ConversationTurn 渲染)', () => {
  it('纯聊天: 用户消息 + 最终回复, 不出现活动栈', () => {
    const user = msg({ id: 'u1', role: 'user', content: '你好', timestamp: 1 })
    const final = msg({ id: 'a1', content: '你好呀' })
    const html = renderToString(React.createElement(ConversationTurn, { user, blocks: [final] as unknown as never[] }))
    expect(html).toContain('你好')
    expect(html).toContain('你好呀')
    expect(html).not.toContain('hq-act-stack')
  })

  it('多步工具回合: 中间步骤折叠为活动行, 最终回复在外, 折叠态不渲染工具详情', () => {
    const user = msg({ id: 'u2', role: 'user', content: '做个贪吃蛇', timestamp: 2 })
    const step1 = msg({ id: 'a2', content: '先写文件', tool_calls: [toolCall('write', 't1')] })
    const step2 = msg({ id: 'a3', content: '再验证', tool_calls: [toolCall('exec_command', 't2'), toolCall('exec_command', 't3')] })
    const final = msg({ id: 'a4', content: '贪吃蛇完成了' })
    const html = renderToString(React.createElement(ConversationTurn, { user, blocks: [step1, step2, final] as unknown as never[] }))
    // 活动行栈: 编辑一行 + 终端一行(同类合并 ×2)
    expect(html).toContain('hq-act-stack')
    expect(html).toContain('hq-act-row')
    expect(html).toContain('>编辑</span>')
    expect(html).toContain('>终端</span>')
    expect(html).toContain('×')
    // 最终回复在栈外
    expect(html).toContain('贪吃蛇完成了')
    // 折叠态: 中间步骤正文与工具参数不渲染
    expect(html).not.toContain('先写文件')
    expect(html).not.toContain('再验证')
    expect(html).not.toContain('hq-tool-result')
  })

  it('无最终回复(中断): 检索活动行存在且可展开', () => {
    const user = msg({ id: 'u3', role: 'user', content: '任务', timestamp: 3 })
    const step1 = msg({ id: 'a5', content: '做到一半', tool_calls: [toolCall('read', 't4')] })
    const html = renderToString(React.createElement(ConversationTurn, { user, blocks: [step1] as unknown as never[] }))
    expect(html).toContain('hq-act-stack')
    expect(html).toContain('>检索</span>')
    expect(html).not.toContain('做到一半') // 折叠态正文不渲染
  })

  it('流式占位(无工具调用)按最终回复渲染, 不进栈', () => {
    const user = msg({ id: 'u4', role: 'user', content: '写点东西', timestamp: 4 })
    const placeholder = msg({ id: 'a6', content: '', _streaming: true })
    const html = renderToString(React.createElement(ConversationTurn, { user, blocks: [placeholder] as unknown as never[] }))
    expect(html).not.toContain('hq-act-stack')
    expect(html).toContain('hq-assistant-content')
  })
})
