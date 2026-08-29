// src/store/slash.test.ts —— 斜杠命令单测(逻辑层)
import { describe, it, expect, beforeAll } from 'vitest'
import { SLASH_DEFS, slashCompletions, execSlash } from './slash'
import { useChatStore } from './chat'

beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>
  if (!g.window) {
    g.window = { alert: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }
  } else {
    ;(g.window as unknown as Record<string, unknown>).alert = () => {}
  }
  if (!g.localStorage) g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  if (!g.window || !(g.window as Record<string, unknown>).huangquan) {
    const w = (g.window as Record<string, unknown>) || {}
    w.huangquan = {
      sessions: { save: () => Promise.resolve(true), load: async () => ({ messages: [] }), list: async () => [], delete: () => Promise.resolve(true) },
      skills: { list: async () => [] },
      computer: {},
      engine: { subscribe: async () => {}, onEvent: () => () => {}, stop: () => Promise.resolve(true), cancel: () => Promise.resolve(true), resume: () => Promise.resolve(true), clarifyRespond: () => Promise.resolve(true), approve: () => Promise.resolve(true), reject: () => Promise.resolve(true), continue: () => Promise.resolve(true) },
      llm: { abort: () => Promise.resolve(true), chat: async () => ({ text: '' }) },
      tasks: { list: async () => [] },
    }
    if (!g.window) g.window = w
  }
})

describe('斜杠命令', () => {
  it('命令表无重复且都以 / 开头', () => {
    const set = new Set(SLASH_DEFS.map(d => d.cmd))
    expect(set.size).toBe(SLASH_DEFS.length)
    for (const d of SLASH_DEFS) expect(d.cmd.startsWith('/')).toBe(true)
  })

  it('补全过滤: /t 命中 title, 空串命中全部', () => {
    const r1 = slashCompletions('t').map(d => d.cmd)
    expect(r1).toContain('/title')
    expect(slashCompletions('').length).toBe(SLASH_DEFS.length)
  })

  it('/new 创建新会话', () => {
    useChatStore.setState({ sessions: [], cid: null })
    expect(execSlash('/new')).toBe(true)
    expect(useChatStore.getState().sessions.length).toBe(1)
    expect(useChatStore.getState().cid).not.toBeNull()
  })

  it('/title 设置当前会话标题', () => {
    expect(execSlash('/title 我的任务')).toBe(true)
    const cur = useChatStore.getState().cur()
    expect(cur?.title).toBe('我的任务')
  })

  it('/stop 与 /usage 安全执行', () => {
    expect(execSlash('/stop')).toBe(true)
    expect(execSlash('/usage')).toBe(true)
  })

  it('未知命令返回 false(不吞掉)', () => {
    expect(execSlash('/nope')).toBe(false)
    expect(execSlash('你好')).toBe(false)
  })
})
