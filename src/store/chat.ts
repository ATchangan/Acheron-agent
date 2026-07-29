import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage } from '../global'

const LIMITS: Record<string, number> = {
  'deepseek-chat': 65536, 'deepseek-reasoner': 65536, 'deepseek-v3': 65536,
  'deepseek-v4': 131072, 'deepseek-v4-flash': 131072, 'deepseek-v4-pro': 131072,
  'gpt-4o': 128000, 'gpt-4o-mini': 128000, 'gpt-4': 8192, 'gpt-3.5': 16385,
  'claude-3': 200000, 'gemini': 131072,
}
function limit(model: string) { for (const [k, v] of Object.entries(LIMITS)) if (model.includes(k)) return v; return 65536 }
function tokens(msgs: any[], sys: string): number {
  let t = sys.length * 0.4
  for (const m of msgs) { const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''); t += Math.ceil((c.match(/[\u4e00-\u9fff]/g) || []).length * 1.5 + (c.length - (c.match(/[\u4e00-\u9fff]/g) || []).length) * 0.3) }
  return Math.ceil(t + 2000)
}

const TOOLS: any[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) 读取文件内容', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) 创建或覆写文件', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) 精确文本替换', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) 执行PowerShell命令。如 {"cmd":"dir Desktop"}', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'mkdir', description: 'mkdir(path) 创建文件夹。如 {"path":"C:/Users/xxx/Desktop/新文件夹"}', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'grep', description: 'grep(dirPath, pattern) 搜索文本', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function', function: { name: 'find', description: 'find(dirPath, glob) 查找文件', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function', function: { name: 'ls', description: 'ls(dirPath?) 列出目录，如 {"dirPath":"C:/Users/xxx/Desktop"}', parameters: { type: 'object', properties: { dirPath: { type: 'string' } } } } },
  { type: 'function', function: { name: 'system_info', description: 'system_info() 系统信息', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'web_search(query) 搜索互联网', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'web_fetch(url) 抓取网页', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() 截屏', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact) 保存记忆', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } } },
]

async function run(name: string, a: any): Promise<string> {
  try {
    switch (name) {
      case 'read': { if (!a.path) return 'E:need path'; const c = await window.huangquan.computer.readFile(a.path); return a.offset ? c.split('\n').slice(+a.offset - 1, (+a.offset - 1) + (+a.limit || 200)).join('\n') : c.slice(0, 50000) }
      case 'write': { if (!a.path || a.content === undefined) return 'E:need path+content'; await window.huangquan.computer.writeFile(a.path, a.content); return `ok: ${a.path} (${a.content.length}c)` }
      case 'edit': { if (!a.path || !a.oldText) return 'E:need path+oldText+newText'; const o = await window.huangquan.computer.readFile(a.path); if (!o.includes(a.oldText)) return 'E:not found'; await window.huangquan.computer.writeFile(a.path, o.replace(a.oldText, a.newText || '')); return `ok: ${a.path}` }
      case 'exec_command': { if (!a.cmd) return 'E:need cmd'; const r = await window.huangquan.computer.exec(a.cmd); return r || '(empty)' }
      case 'mkdir': { if (!a.path) return 'E:need path'; await window.huangquan.computer.exec('mkdir "' + a.path.replace(/\\/g, '/') + '"'); return 'ok: ' + a.path }
      case 'grep': { if (!a.dirPath || !a.pattern) return 'E:need dirPath+pattern'; return await window.huangquan.computer.grep(a.dirPath, a.pattern) || '(none)' }
      case 'find': { if (!a.dirPath || !a.glob) return 'E:need dirPath+glob'; return await window.huangquan.computer.find(a.dirPath, a.glob) || '(none)' }
      case 'ls': { const items = await window.huangquan.computer.readDir(a.dirPath || '.'); return items.length ? items.map(i => `${i.isDirectory ? 'd' : 'f'} ${i.name} ${i.size}B`).join('\n') : '(empty)' }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': { if (!a.query) return 'E:need query'; return await window.huangquan.web.search(a.query) || '(none)' }
      case 'web_fetch': return await window.huangquan.web.fetch(a.url || 'about:blank')
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'save_memory': { const m = await window.huangquan.memory.load(); m.facts.push(a.fact); await window.huangquan.memory.save(m); return 'ok:saved' }
      default: return `E:unknown:${name}`
    }
  } catch (e: any) { return `E:${e.message}` }
}

interface S {
  sessions: SessionData[]; cid: string | null; streaming: boolean
  error: string | null; sp: string; cu: number; cl: number
  terminal: { id: string; name: string; args: any; result: string; time: number }[]
  load: () => Promise<void>
  reloadPrompt: () => Promise<void>
  create: () => string; switchS: (id: string) => void; del: (id: string) => void
  send: (c: string, imgs?: string[]) => Promise<void>
  regen: () => Promise<void>; cur: () => SessionData | undefined
}

export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, streaming: false, error: null, sp: '', cu: 0, cl: 65536, terminal: [],
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ general: { mode: 'work' } }))
    const [ishiki, skills, mem, metas] = await Promise.all([
      window.huangquan.ishiki.load().catch(() => ''),
      window.huangquan.skills.list().catch(() => []),
      window.huangquan.memory.load().catch(() => ({ facts: [], summaries: [] })),
      window.huangquan.sessions.list().catch(() => []),
    ])
    const mode = cfg.general?.mode || 'work'
    const ss = skills.length ? '\nSkills\n' + skills.map(s => `- ${s.name}: ${s.description}`).join('\n') : ''
    const ms = mem.facts.length ? '\nMemory\n' + mem.facts.map((f: string, i: number) => `${i + 1}. ${f}`).join('\n') : ''
    let prompt = ''
    const tl = TOOLS.map(t => `- ${t.function.name}(${Object.keys(t.function.parameters.properties || {}).join(', ')})`).join('\n')
    if (mode === 'chat') {
      prompt = `${ishiki.slice(0, 2000)}\n\n黄泉，出云国幸存者，巡海游侠。\n\n## Tools\n${tl}\n\n- 淡漠寡言，克制优雅\n- 每次回复前<reflect>思考\n- 图片/搜索/文件操作用工具${ms}${ss}`
    } else {
      prompt = `黄泉桌面Agent，操控电脑、读写文件、执行命令、搜索网页、截图。\n\n## 能力\n${tl}\n\n## 准则\n- 直接调用工具操作电脑，无需确认\n- 创建文件夹: mkdir(path)，命令: exec_command(cmd)\n- 读取前先ls(dirPath)确认路径\n- 写入前先read检查内容\n- 失败分析错误修正重试\n- <reflect>思考${ms}${ss}`
    }
    set({ sp: prompt, cu: 0, cl: mode === 'chat' ? 65536 : 131072 })
    const sessions = await Promise.all(metas.map((m: any) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: '对话', messages: [], mode: 'work' }))))
    const curMode = cfg.general?.mode || 'work'
    const modeSessions = sessions.filter((s: any) => (s.mode || 'work') === curMode)
    if (modeSessions.length === 0) {
      const id = uuidv4(), ns: SessionData = { id, title: '新对话', messages: [], mode: curMode }
      sessions.unshift(ns)
      window.huangquan.sessions.save(ns)
      set({ sessions: [...sessions], cid: id })
    } else {
      set({ sessions, cid: modeSessions[0]?.id || null })
    }
  },

  reloadPrompt: async () => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ general: { mode: 'work' } }))
    const ishiki = await window.huangquan.ishiki.load().catch(() => '')
    const mode = cfg.general?.mode || 'work'
    const tl = TOOLS.map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters.properties || {}).join(', ') + ')').join('\n')
    set({ sp: mode === 'chat'
      ? ishiki.slice(0, 2000) + '\n\n' + '黄泉，出云国幸存者，巡海游侠。\n\n## Tools\n' + tl + '\n\n- 淡漠寡言，克制优雅\n- 每次回复前<reflect>思考'
      : '黄泉桌面Agent。\n\n## 能力\n' + tl + '\n\n- 直接调用工具\n- mkdir创建文件夹，exec_command执行命令\n- ls确认路径，read检查内容\n- 失败修正重试'
    })
  },
  create: () => {
    const cfg = useSettingsStore.getState().general
    const id = uuidv4(), s: SessionData = { id, title: '新对话', messages: [], mode: cfg.mode || 'work' }
    set(st => ({ sessions: [s, ...st.sessions], cid: id }))
    window.huangquan.sessions.save(s); return id
  },
  switchS: (id) => set({ cid: id, error: null }),
  del: (id) => { window.huangquan.sessions.delete(id); set(st => { const f = st.sessions.filter(s => s.id !== id); return { sessions: f, cid: st.cid === id ? f[0]?.id || null : st.cid } }) },

  send: async (content, images) => {
    const state = get(); let sid = state.cid || state.create()
    if (state.streaming) await window.huangquan.llm.abort()
    let session = { ...get().sessions.find(s => s.id === sid)! }
    session.messages = [...session.messages, { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images } as Message]
    set(st => ({ sessions: st.sessions.map(s => s.id === sid ? session : s), streaming: true, error: null }))
    const cfg = await window.huangquan.settings.load()
    const p = cfg.providers[0]; if (!p) { set({ streaming: false, error: '请先添加 API Provider' }); return }
    const model = p.selectedModel || p.models[0] || 'deepseek-v4-pro'
    const mode = cfg.general?.mode || 'work'
    const L = limit(model); set({ cl: L })

    const build = (msgs: Message[]): LLMMessage[] => {
      let eff = msgs; const est = tokens(msgs, state.sp); set({ cu: est })
      if (est > L * 0.8 && msgs.length > 10) { let kept = msgs.slice(-6); const rest = msgs.slice(0, -6); while (tokens(kept, state.sp) < L * 0.4 && rest.length) kept = [rest.pop()!, ...kept]; if (rest.length) { eff = [{ id: 'zip', role: 'user', content: `[${rest.length}条历史已压缩]`, timestamp: 0 } as Message, ...kept]; set({ cu: tokens(eff, state.sp) }) } }
      const d: LLMMessage[] = []
      for (const m of eff) { if ((m as any).pending) continue; if (m.role === 'tool') d.push({ role: 'tool', content: m.content, tool_call_id: (m as any).tool_call_id || '0' }); else if (m.role === 'assistant' && (m as any).tool_calls) d.push({ role: 'assistant', content: null, tool_calls: (m as any).tool_calls }); else if (m.role === 'user' && m.images?.length) { const parts: any[] = [{ type: 'text', text: m.content }]; m.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } })); d.push({ role: 'user', content: parts }) } else if (m.role === 'user' || m.role === 'assistant') d.push({ role: m.role, content: m.content || ' ' }) }
      return state.sp ? [{ role: 'system', content: state.sp }, ...d] : d
    }

    const call = (msgs: LLMMessage[]): Promise<{ text: string; tcs: { id: string; name: string; args: any }[] }> =>
      new Promise((resolve, reject) => {
        const cbs: (() => void)[] = []; let text = ''; const tcs: any[] = []
        cbs.push(window.huangquan.llm.onChunk(d => { text += d.content; set(st => { const ss = st.sessions.map(s => { if (s.id !== sid) return s; const ms = [...s.messages]; for (let i = ms.length - 1; i >= 0; i--) { if (ms[i].role === 'assistant' && !(ms[i] as any).tool_calls) { ms[i] = { ...ms[i], content: text }; break } } if (ms.length >= 2 && text.length > 10 && s.title === '新对话') s.title = text.slice(0, 40) + (text.length > 40 ? '...' : ''); return { ...s, messages: ms } }); return { sessions: ss, streaming: !d.done } }); if (d.done) { cbs.forEach(f => f()); resolve({ text, tcs }) } }))
        cbs.push(window.huangquan.llm.onError(e => { cbs.forEach(f => f()); reject(new Error(e)) }))
        cbs.push(window.huangquan.llm.onToolCall((tc: any) => { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) }))
        window.huangquan.llm.chat({ provider: p.type, model, apiKey: p.apiKey, baseUrl: p.baseUrl, messages: msgs as any, temperature: .7, tools: TOOLS }).catch(e => { cbs.forEach(f => f()); reject(e) })
      })

    try {
      let to = false; const t = setTimeout(() => { to = true; window.huangquan.llm.abort() }, 120000)
      session.messages.push({ id: uuidv4(), role: 'assistant', content: '', timestamp: Date.now() })
      set(st => ({ sessions: st.sessions.map(s => s.id === sid ? { ...session } : s) }))
      let res = await call(build(session.messages)); clearTimeout(t)
      if (to) { set({ streaming: false, error: '请求超时' }); return }
      for (let r = 0; res.tcs.length && r < 5; r++) {
        const tcs = res.tcs
        session.messages.push({ id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: tcs.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) } as any)
        for (const tc of tcs) session.messages.push({ id: uuidv4(), role: 'tool', content: '...', timestamp: Date.now(), tool_call_id: tc.id, pending: true } as any)
        set(st => ({ sessions: st.sessions.map(s => s.id === sid ? { ...session } : s) }))
        for (const tc of tcs) { const result = await run(tc.name, tc.args); for (const m of session.messages) if ((m as any).tool_call_id === tc.id && (m as any).pending) { m.content = result; (m as any).pending = false }; set(st => ({ terminal: [...st.terminal, { id: uuidv4(), name: tc.name, args: tc.args, result, time: Date.now() }] })) }
        session.messages.push({ id: uuidv4(), role: 'assistant', content: '', timestamp: Date.now() })
        set(st => ({ sessions: st.sessions.map(s => s.id === sid ? { ...session } : s) }))
        res = await call(build(session.messages))
      }
      set({ streaming: false, error: null }); const f = get().sessions.find(s => s.id === sid); if (f) window.huangquan.sessions.save(f)
    } catch (e: any) { set({ streaming: false, error: e.message || String(e) }) }
  },

  regen: async () => {
    const s = get().cur(); if (!s || get().streaming) return
    const lu = [...s.messages].reverse().find(m => m.role === 'user'); if (!lu) return
    let idx = -1; for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'assistant' || s.messages[i].role === 'tool') idx = i; else break }
    if (idx >= 0) s.messages.splice(idx)
    set(st => ({ sessions: st.sessions.map(ss => ss.id === s.id ? { ...s } : ss) }))
    await get().send(lu.content, lu.images)
  },
}))
