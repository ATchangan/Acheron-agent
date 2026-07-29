import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage } from '../global'
import { useSettingsStore } from './settings'

const TOOLS: any[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) read file', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) create/overwrite file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) precise text replace', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) run PowerShell command', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'mkdir', description: 'mkdir(path) create folder', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'grep', description: 'grep(dirPath, pattern) search text in files', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function', function: { name: 'find', description: 'find(dirPath, glob) find files by pattern', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function', function: { name: 'ls', description: 'ls(dirPath?) list directory', parameters: { type: 'object', properties: { dirPath: { type: 'string' } } } } },
  { type: 'function', function: { name: 'system_info', description: 'system_info() get CPU/RAM info', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'web_search(query) search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'web_fetch(url) fetch webpage content', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() capture screen', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact) save to memory', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } } },
]

async function runTool(name: string, a: any): Promise<string> {
  try {
    switch (name) {
      case 'read': { if (!a.path) return 'E:need path'; const c = await window.huangquan.computer.readFile(a.path); return a.offset ? c.split('\n').slice(+a.offset - 1, (+a.offset - 1) + (+a.limit || 200)).join('\n') : c.slice(0, 50000) }
      case 'write': { if (!a.path || a.content === undefined) return 'E:need path+content'; await window.huangquan.computer.writeFile(a.path, a.content); return 'ok: ' + a.path + ' (' + a.content.length + 'c)' }
      case 'edit': { if (!a.path || !a.oldText) return 'E:need path+oldText+newText'; const o = await window.huangquan.computer.readFile(a.path); if (!o.includes(a.oldText)) return 'E:not found'; await window.huangquan.computer.writeFile(a.path, o.replace(a.oldText, a.newText || '')); return 'ok: ' + a.path }
      case 'exec_command': { if (!a.cmd) return 'E:need cmd'; const r = await window.huangquan.computer.exec(a.cmd); return r || '(empty)' }
      case 'mkdir': { if (!a.path) return 'E:need path'; await window.huangquan.computer.exec('mkdir "' + a.path.replace(/\\/g, '/') + '"'); return 'ok: ' + a.path }
      case 'grep': { if (!a.dirPath || !a.pattern) return 'E:need dirPath+pattern'; return await window.huangquan.computer.grep(a.dirPath, a.pattern) || '(none)' }
      case 'find': { if (!a.dirPath || !a.glob) return 'E:need dirPath+glob'; return await window.huangquan.computer.find(a.dirPath, a.glob) || '(none)' }
      case 'ls': { const items = await window.huangquan.computer.readDir(a.dirPath || '.'); return items.length ? items.map(i => (i.isDirectory ? 'd' : 'f') + ' ' + i.name + ' ' + i.size + 'B').join('\n') : '(empty)' }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': { if (!a.query) return 'E:need query'; return await window.huangquan.web.search(a.query) || '(none)' }
      case 'web_fetch': return await window.huangquan.web.fetch(a.url || 'about:blank')
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'save_memory': { const m = await window.huangquan.memory.load(); m.facts.push(a.fact); await window.huangquan.memory.save(m); return 'ok:saved' }
      default: return 'E:unknown:' + name
    }
  } catch (e: any) { return 'E:' + e.message }
}

function buildPrompt(mode: string, ishiki: string): string {
  const tl = TOOLS.map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters.properties || {}).join(',') + ')').join('\n')
  return mode === 'chat'
    ? ishiki.slice(0, 2000) + '\n\nHuangQuan, survivor of Izumo, Galaxy Ranger.\n\n## Tools\n' + tl + '\n\n- Reserved, elegant, few words\n- Think in <reflect> before reply'
    : 'HuangQuan Desktop Agent. Control PC, read/write files, run commands, search web.\n\n## Tools\n' + tl + '\n\n- Call tools directly, no asking\n- mkdir to create folders, exec_command for commands\n- ls before read, read before write\n- Retry on failure'
}

interface S {
  sessions: SessionData[]; cid: string | null; sp: string; streaming: boolean; error: string | null
  terminal: { id: string; name: string; args: any; result: string; time: number }[]
  cu: number; cl: number
  load: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  create: () => void
  switchS: (id: string) => void
  del: (id: string) => void
  send: (c: string, imgs?: string[]) => Promise<void>
  regen: () => Promise<void>
  cur: () => SessionData | undefined
}

export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, sp: '', streaming: false, error: null, terminal: [], cu: 0, cl: 65536,
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    const [cfg, ishiki, metas] = await Promise.all([
      window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } })),
      window.huangquan.ishiki.load().catch(() => ''),
      window.huangquan.sessions.list().catch(() => []),
    ])
    const mode = cfg.general?.mode || 'work'
    const sp = buildPrompt(mode, ishiki)
    const sessions = await Promise.all(metas.map((m: any) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: 'Chat', messages: [], mode: 'work' }))))
    const ms = sessions.filter((s: any) => (s.mode || 'work') === mode)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode }
      sessions.unshift(ns)
      window.huangquan.sessions.save(ns)
    }
    set({ sessions, cid: (ms[0] || sessions[0]).id, sp })
  },

  setMode: async (m) => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } }))
    cfg.general.mode = m; await window.huangquan.settings.save(cfg)
    useSettingsStore.getState().load()
    const ishiki = await window.huangquan.ishiki.load().catch(() => '')
    const sp = buildPrompt(m, ishiki)
    const sessions = [...get().sessions]
    const ms = sessions.filter(s => (s.mode || 'work') === m)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
      sessions.unshift(ns)
      window.huangquan.sessions.save(ns)
      set({ sessions, cid: ns.id, sp })
    } else {
      set({ sessions, cid: ms[0].id, sp })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id }))
    window.huangquan.sessions.save(ns)
  },
  switchS: (id) => set({ cid: id, error: null }),
  del: (id) => {
    window.huangquan.sessions.delete(id)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid } })
  },

  send: async (content, images) => {
    const state = get()
    let sid = state.cid; if (!sid) { get().create(); sid = get().cid! }
    if (state.streaming) await window.huangquan.llm.abort()
    let session = { ...get().sessions.find(s => s.id === sid)! }
    session.messages = [...session.messages, { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images } as Message]
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? session : x), streaming: true, error: null }))
    const cfg = await window.huangquan.settings.load()
    const p = cfg.providers[0]; if (!p) { set({ streaming: false, error: 'No API provider' }); return }
    const model = p.selectedModel || p.models[0] || 'deepseek-v4-pro'

    const build = (msgs: Message[]): LLMMessage[] => {
      const d: LLMMessage[] = []
      for (const m of msgs) {
        if (m.role === 'tool') d.push({ role: 'tool', content: m.content, tool_call_id: (m as any).tool_call_id || '0' })
        else if (m.role === 'assistant' && (m as any).tool_calls) d.push({ role: 'assistant', content: null, tool_calls: (m as any).tool_calls })
        else if (m.role === 'user' && m.images?.length) { const parts: any[] = [{ type: 'text', text: m.content }]; m.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } })); d.push({ role: 'user', content: parts }) }
        else if (m.role === 'user' || m.role === 'assistant') d.push({ role: m.role, content: m.content || ' ' })
      }
      return state.sp ? [{ role: 'system', content: state.sp }, ...d] : d
    }

    const call = (msgs: LLMMessage[], aid: string): Promise<{ text: string; tcs: { id: string; name: string; args: any }[] }> =>
      new Promise((resolve, reject) => {
        const cbs: (() => void)[] = []; let text = ''; const tcs: any[] = []
        cbs.push(window.huangquan.llm.onChunk(d => {
          text += d.content
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text } : m) } : x), streaming: !d.done }))
          if (d.done) { cbs.forEach(f => f()); resolve({ text, tcs }) }
        }))
        cbs.push(window.huangquan.llm.onError(e => { cbs.forEach(f => f()); reject(new Error(e)) }))
        cbs.push(window.huangquan.llm.onToolCall((tc: any) => { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) }))
        window.huangquan.llm.chat({ provider: p.type, model, apiKey: p.apiKey, baseUrl: p.baseUrl, messages: msgs as any, temperature: .7, tools: TOOLS }).catch(e => { cbs.forEach(f => f()); reject(e) })
      })

    try {
      const timer = setTimeout(() => window.huangquan.llm.abort(), 120000)
      let aid = uuidv4(); session.messages.push({ id: aid, role: 'assistant', content: '', timestamp: Date.now() })
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...session } : x) }))
      let res = await call(build(session.messages), aid); clearTimeout(timer)

      for (let r = 0; res.tcs.length && r < 5; r++) {
        session.messages.push({ id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: res.tcs.map((tc: any) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args) } })) } as any)
        for (const tc of res.tcs) { const r2 = await runTool(tc.name, tc.args); session.messages.push({ id: uuidv4(), role: 'tool', content: r2, timestamp: Date.now(), tool_call_id: tc.id } as any); set(s => ({ terminal: [...s.terminal, { id: uuidv4(), name: tc.name, args: tc.args, result: r2, time: Date.now() }] })) }
        aid = uuidv4(); session.messages.push({ id: aid, role: 'assistant', content: '', timestamp: Date.now() })
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...session } : x) }))
        res = await call(build(session.messages), aid)
      }
      set({ streaming: false, error: null })
      const lastContent = session.messages[session.messages.length - 1]?.content || ''
      if (!lastContent.trim() && session.messages.some(m => m.role === 'tool')) {
        session.messages.push({ id: uuidv4(), role: 'user', content: 'Summarize the results', timestamp: Date.now() })
        aid = uuidv4(); session.messages.push({ id: aid, role: 'assistant', content: '', timestamp: Date.now() })
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...session } : x) }))
        await call(build(session.messages), aid)
      }
      const f = get().sessions.find(s => s.id === sid); if (f) window.huangquan.sessions.save(f)
    } catch (e: any) { set({ streaming: false, error: e.message || String(e) }) }
  },

  regen: async () => {
    const s = get().cur(); if (!s || get().streaming) return
    const lu = [...s.messages].reverse().find(m => m.role === 'user' && !m.content.startsWith('Summarize')); if (!lu) return
    let idx = -1; for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'assistant') { idx = i; break } }
    if (idx >= 0) { const msgs = s.messages.slice(0, idx); set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) })) }
    else set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x } : x) }))
    await get().send(lu.content, lu.images)
  },
}))
