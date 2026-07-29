import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage } from '../global'

const COMPUTER_TOOLS = [
  { type: 'function' as const, function: { name: 'read', description: '读取文件。参数: path, offset(可选), limit(可选)', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function' as const, function: { name: 'write', description: '写入文件。参数: path, content', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function' as const, function: { name: 'edit', description: '编辑文件。参数: path, oldText, newText', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function' as const, function: { name: 'exec_command', description: '执行PowerShell命令。参数: cmd', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function' as const, function: { name: 'grep', description: '搜索文本。参数: dirPath, pattern', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function' as const, function: { name: 'find', description: '查找文件。参数: dirPath, glob(如 *.ts)', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function' as const, function: { name: 'ls', description: '列出目录。参数: dirPath', parameters: { type: 'object', properties: { dirPath: { type: 'string' } }, required: ['dirPath'] } } },
  { type: 'function' as const, function: { name: 'system_info', description: '获取系统信息', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'web_search', description: '搜索互联网获取实时信息。参数: query (中文或英文搜索词)', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function' as const, function: { name: 'web_fetch', description: '获取网页URL的文本内容。参数: url (完整URL)', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function' as const, function: { name: 'screenshot', description: '截屏', parameters: { type: 'object', properties: {} } } },
  { type: 'function' as const, function: { name: 'save_memory', description: '保存记忆。参数: fact', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } } },
  { type: 'function' as const, function: { name: 'recall_memory', description: '回顾记忆', parameters: { type: 'object', properties: {} } } },
]

// 模型上下文上限（token）
const MODEL_LIMITS: Record<string, number> = {
  'deepseek-chat': 65536, 'deepseek-reasoner': 65536, 'deepseek-v3': 65536,
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4-turbo': 128000,
  'gpt-4': 8192, 'gpt-3.5-turbo': 16385,
  'claude-3-5-sonnet': 200000, 'claude-3-opus': 200000, 'claude-3-haiku': 200000,
  'gemini-pro': 32768, 'qwen-max': 32768, 'qwen-plus': 131072,
  'glm-4': 131072, 'moonshot-v1': 131072,
}

// 估算 token (中文 1 字≈1.5 token, 英文 1 词≈1.3 token)
function estimateTokens(messages: any[], sysPrompt: string): number {
  let total = sysPrompt.length * 0.4
  for (const m of messages) {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')
    const cn = (c.match(/[\u4e00-\u9fff]/g) || []).length
    total += Math.ceil(cn * 1.5 + (c.length - cn) * 0.3)
  }
  return Math.ceil(total + 1500) // +工具定义等
}

function getModelLimit(model: string): number {
  for (const [k, v] of Object.entries(MODEL_LIMITS)) if (model.includes(k)) return v
  return 65536 // 默认 64K
}

interface ChatStore {
  sessions: SessionData[]; currentId: string | null
  streaming: boolean; error: string | null; systemPrompt: string
  contextUsed: number; contextLimit: number
  abortController: AbortController | null
  loadSessions: () => Promise<void>
  loadSystemPrompt: () => Promise<void>
  createSession: () => string
  switchSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  sendMessage: (content: string, images?: string[]) => Promise<void>
  regenerateLast: () => Promise<void>
  getCurrentSession: () => SessionData | undefined
}

async function executeToolCall(name: string, args: any): Promise<string> {
  if (!args) args = {}
  try {
    switch (name) {
      case 'read': {
        if (!args.path) return '错误: 缺少 path 参数'
        const c = await window.huangquan.computer.readFile(args.path)
        if (args.offset) return c.split('\n').slice(args.offset - 1, (args.offset - 1) + (args.limit || 200)).join('\n')
        return c.slice(0, 50000)
      }
      case 'write': {
        if (!args.path || args.content === undefined) return '错误: 缺少 path 或 content 参数'
        await window.huangquan.computer.writeFile(args.path, args.content)
        return `已写入: ${args.path} (${(args.content || '').length} 字符)`
      }
      case 'edit': {
        const old = await window.huangquan.computer.readFile(args.path)
        if (!old.includes(args.oldText)) return `编辑失败: 未找到匹配文本 (文件: ${args.path})`
        await window.huangquan.computer.writeFile(args.path, old.replace(args.oldText, args.newText))
        return `已编辑: ${args.path}`
      }
      case 'exec_command': {
        if (!args.cmd) return '错误: 缺少 cmd 参数，请提供要执行的命令'
        const result = await window.huangquan.computer.exec(args.cmd)
        return result || '(命令执行完成，无输出)'
      }
      case 'grep': {
        if (!args.dirPath || !args.pattern) return '错误: 缺少 dirPath 或 pattern 参数'
        return await window.huangquan.computer.grep(args.dirPath, args.pattern)
      }
      case 'find': {
        if (!args.dirPath || !args.glob) return '错误: 缺少 dirPath 或 glob 参数'
        return await window.huangquan.computer.find(args.dirPath, args.glob)
      }
      case 'ls': {
        const dir = args.dirPath || args.path || '.'
        const items = await window.huangquan.computer.readDir(dir)
        return items.map(i => `${i.isDirectory ? 'd' : 'f'} ${i.name} (${i.size}B)`).join('\n')
      }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': {
        if (!args.query) return '请提供搜索词'
        return await window.huangquan.web.search(args.query)
      }
      case 'web_fetch': return await window.huangquan.web.fetch(args.url || 'about:blank')
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'save_memory': {
        const m = await window.huangquan.memory.load(); m.facts.push(args.fact)
        await window.huangquan.memory.save(m); return 'saved'
      }
      case 'recall_memory': {
        const m = await window.huangquan.memory.load()
        return m.facts.length ? m.facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n') : '(empty)'
      }
      default: return `unknown tool: ${name}`
    }
  } catch (err: any) { return 'Error: ' + err.message }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  sessions: [], currentId: null, streaming: false, error: null,
  systemPrompt: '', contextUsed: 0, contextLimit: 65536,
  abortController: null,

  getCurrentSession: () => get().sessions.find(s => s.id === get().currentId),

  loadSystemPrompt: async () => {
    try {
      const ishiki = await window.huangquan.ishiki.load()
      const skills = await window.huangquan.skills.list()
      const skillsStr = skills.length ? '\n\n## 可用技能\n' + skills.map(s => `- **${s.name}**: ${s.description}`).join('\n') : ''
      const mem = await window.huangquan.memory.load()
      const memStr = mem.facts.length ? '\n\n## 用户记忆\n' + mem.facts.map((f, i) => `${i + 1}. ${f}`).join('\n') : ''

      const prompt = `你是黄泉（Acheron），出云国最后的幸存者，独行银河的巡海游侠。身配长刀「无」，行走于"有"与"无"的狭间。

${ishiki.slice(0, 800)}

## 沉思

每次回复前，你必须先在 <reflect></reflect> 标签内进行深度思考。格式如下：

<reflect>
Premise: 前提假设（3条）
Conduct: 推理链条（3条）
Reflection: 薄弱环节（3条）
Act: 行动方案（2条）
</reflect>

## 沟通规则
- 寡言但精准：能用三句说完不用五句
- 克制但不冷漠：用行动说话，不空泛安慰
- 回答的技术内容须扎实准确
- 你可以调用 tools 操作电脑、读写文件、执行命令、搜索网页

## 环境
平台: Windows, Shell: PowerShell, 工作目录: 当前上下文${memStr}${skillsStr}`
      set({ systemPrompt: prompt })
    } catch { set({ systemPrompt: '你是黄泉，桌面AI助手。' }) }
  },

  loadSessions: async () => {
    try {
      const metas = await window.huangquan.sessions.list()
      const sessions = await Promise.all(metas.map(m => window.huangquan.sessions.load(m.id)))
      set({ sessions, currentId: sessions[0]?.id || null })
    } catch { /* ok */ }
  },

  createSession: () => {
    const id = uuidv4(); const s: SessionData = { id, title: '新对话', messages: [] }
    set(st => ({ sessions: [s, ...st.sessions], currentId: id }))
    window.huangquan.sessions.save(s); return id
  },

  switchSession: (id) => set({ currentId: id, error: null }),

  deleteSession: async (id) => {
    await window.huangquan.sessions.delete(id)
    set(st => { const f = st.sessions.filter(s => s.id !== id); return { sessions: f, currentId: st.currentId === id ? f[0]?.id || null : st.currentId } })
  },

  sendMessage: async (content, images) => {
    const state = get()
    let currentId = state.currentId || state.createSession()
    let session = { ...get().sessions.find(s => s.id === currentId)! }

    const userMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images }
    session.messages = [...session.messages, userMsg]
    
    // 打断当前流
    if (get().streaming) {
      await window.huangquan.llm.abort()
    }
    const ac = new AbortController()
    set(st => ({ sessions: st.sessions.map(s => s.id === currentId ? session : s), streaming: true, error: null, abortController: ac }))
    const safetyTimer = setTimeout(() => {
      window.huangquan.llm.abort()
      set({ streaming: false, error: '请求超时 (120s)' })
    }, 120000)

    const settings = await window.huangquan.settings.load()
    const provider = settings.providers[0]
    if (!provider) { set({ error: '请先添加 API Provider', streaming: false }); return }

    // 构建 API 消息（按模型上下文动态压缩）
    const buildApiMessages = (msgs: Message[]): LLMMessage[] => {
      const sysMsg = state.systemPrompt ? [{ role: 'system', content: state.systemPrompt }] : []
      const limit = getModelLimit(provider.selectedModel || provider.models[0] || 'deepseek-chat')
      set({ contextLimit: limit })
      
      // 估算 token 并压缩到 80% 上限
      let effective = msgs
      const total = estimateTokens(msgs, state.systemPrompt)
      set({ contextUsed: total })
      
      if (total > limit * 0.8 && msgs.length > 6) {
        // 从前面裁减到 50% 上限为止
        let kept = msgs.slice(-6) // 至少保留最后 6 条
        let cut = msgs.slice(0, -6)
        while (estimateTokens(kept, state.systemPrompt) < limit * 0.5 && cut.length > 0) {
          kept = [cut.pop()!, ...kept]
        }
        if (cut.length > 0) {
          effective = [{ id: 'summary', role: 'user', content: `[${cut.length} 条历史消息已压缩]`, timestamp: 0 } as Message, ...kept]
        }
        const newTotal = estimateTokens(effective, state.systemPrompt)
        set({ contextUsed: newTotal })
      }
      
      const dialog: LLMMessage[] = []
      for (const m of effective) {
        if (m.role === 'tool') {
          dialog.push({ role: 'tool', content: m.content, tool_call_id: (m as any).tool_call_id || 'unknown' })
        } else if (m.role === 'user' && m.images?.length) {
          const parts: any[] = [{ type: 'text', text: m.content }]
          for (const img of m.images) parts.push({ type: 'image_url', image_url: { url: img } })
          dialog.push({ role: 'user', content: parts })
        } else if (m.role === 'assistant' && (m as any).tool_calls) {
          // assistant 带了 tool_calls 时，content 必须为 null
          dialog.push({ role: 'assistant', content: null, tool_calls: (m as any).tool_calls })
        } else if (m.role === 'user' || m.role === 'assistant') {
          dialog.push({ role: m.role, content: m.content || ' ' })
        }
      }
      return [...sysMsg, ...dialog]
    }

    const doApiCall = async (messages: LLMMessage[]): Promise<{ content: string; toolCalls: { id: string; name: string; args: any }[] }> => {
      return new Promise((resolve, reject) => {
        const cleanupFns: (() => void)[] = []
        let content = ''
        const toolCalls: { id: string; name: string; args: any }[] = []

        const done = () => { cleanupFns.forEach(c => c()); resolve({ content, toolCalls }) }
        const fail = (e: Error) => { cleanupFns.forEach(c => c()); reject(e) }

        cleanupFns.push(window.huangquan.llm.onChunk(d => {
          content += d.content
          set(st => {
            const sessions = st.sessions.map(s => {
              if (s.id !== currentId) return s
              const msgs = [...s.messages]
              for (let i = msgs.length - 1; i >= 0; i--) {
                if (msgs[i].role === 'assistant') { msgs[i] = { ...msgs[i], content }; break }
              }
              if (msgs.length >= 2 && content.length > 10 && s.title === '新对话')
                s.title = content.slice(0, 40) + (content.length > 40 ? '...' : '')
              return { ...s, messages: msgs }
            })
            return { sessions, streaming: !d.done }
          })
          if (d.done) done()
        }))

        cleanupFns.push(window.huangquan.llm.onError(e => fail(new Error(e))))
        cleanupFns.push(window.huangquan.llm.onToolCall((tc: any) => {
          if (tc.function?.name) {
            toolCalls.push({ id: tc.id || 'call_' + Date.now(), name: tc.function.name, args: JSON.parse(tc.function.arguments || '{}') })
          }
        }))

        window.huangquan.llm.chat({
          provider: provider.type, model: provider.selectedModel || provider.models[0] || 'deepseek-chat',
          apiKey: provider.apiKey, baseUrl: provider.baseUrl,
          messages: messages as any, temperature: 0.7, tools: COMPUTER_TOOLS,
        }).catch(fail)
      })
    }

    try {
      // 初始调用
      const apiMessages = buildApiMessages(session.messages)
      const assistantMsg: Message = { id: uuidv4(), role: 'assistant', content: '', timestamp: Date.now() }
      session.messages = [...session.messages, assistantMsg]
      set(st => ({ sessions: st.sessions.map(s => s.id === currentId ? session : s) }))

      let result = await doApiCall(apiMessages)

      // 工具调用循环
      let round = 0
      while (result.toolCalls.length > 0 && round < 5) {
        round++
        for (const tc of result.toolCalls) {
          const toolResult = await executeToolCall(tc.name, tc.args)
          const toolMsg = { id: uuidv4(), role: 'tool' as const, content: toolResult, timestamp: Date.now(), tool_call_id: tc.id } as any
          session.messages.push(toolMsg)

          // 在 assistant 消息上标记 tool_calls
          const lastAsst = [...session.messages].reverse().find(m => m.role === 'assistant')
          if (lastAsst) {
            (lastAsst as any).tool_calls = result.toolCalls.map(tc => ({
              id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) }
            }))
          }
        }

        set(st => ({ sessions: st.sessions.map(s => s.id === currentId ? { ...session } : s) }))

        // 继续对话
        const nextAssistant: Message = { id: uuidv4(), role: 'assistant', content: '', timestamp: Date.now() }
        session.messages.push(nextAssistant)
        set(st => ({ sessions: st.sessions.map(s => s.id === currentId ? { ...session } : s) }))

        const nextMessages = buildApiMessages(session.messages)
        result = await doApiCall(nextMessages)
      }

      set(st => ({ streaming: false, abortController: null }))
      clearTimeout(safetyTimer)
      const finalSession = get().sessions.find(s => s.id === currentId)
      if (finalSession) window.huangquan.sessions.save(finalSession)

    } catch (err: any) {
      clearTimeout(safetyTimer)
      set({ error: err.message, streaming: false, abortController: null })
    }
  },

  regenerateLast: async () => {
    const state = get()
    const session = state.getCurrentSession()
    if (!session || state.streaming) return
    const msgs = session.messages.filter(m => m.role !== 'tool')
    const lastUser = msgs.filter(m => m.role === 'user').slice(-1)[0]
    if (!lastUser) return
    // 删掉最后一条 assistant 和后续 tool 消息
    let lastAsstIdx = -1
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') { lastAsstIdx = i; break }
    }
    if (lastAsstIdx >= 0) {
      session.messages.splice(lastAsstIdx, 1)
      while (session.messages.length > lastAsstIdx && session.messages[lastAsstIdx]?.role === 'tool') {
        session.messages.splice(lastAsstIdx, 1)
      }
    }
    set(st => ({ sessions: st.sessions.map(s => s.id === session.id ? { ...s } : s) }))
    await get().sendMessage(lastUser.content, lastUser.images)
  },
}))
