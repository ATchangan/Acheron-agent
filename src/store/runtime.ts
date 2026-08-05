// src/store/runtime.ts —— 工具循环/中断令牌/工具执行(v0.3.0 M2)
// 职责: runTool 及工具分支/analyzeWithVision/taskGen 中断令牌/工具缓存
// 迁移自 chat.ts() —— 行为未改
// 注意: 依赖 chat.ts 的 useChatStore(运行时循环依赖, 函数体内延迟解析, 安全)
import { useSettingsStore } from './settings'
import { useChatStore } from './chat'
import { useAgents } from './agents'
import { TOOLS, filterToolsByAgent } from './tools'
import { PLUGIN_TOOLS, PLUGIN_TOOL_NAMES } from './plugins'
import { safeIPC } from '../utils/safe'
import { CACHE_TTL, WORKFLOWS } from './constants'
import { scanMemoryText } from './memory'
import type { ProviderConfig, MediaProvider, MemoryData } from '../global'
import type { ToolSpec } from '../types'
import type { SettingsData } from '../global'
import { buildPrompt, isVisionModel } from './context'
import { runDispatch } from './subtask'
import { errMsg } from '../utils/safe'

export const toolCache = new Map<string, { result: string; ts: number }>()
export const costedReqs = new Set<string>()
// watch_file 状态(模块级, 取代 window.__watchState 全局)
const watchState: Record<string, string> = {}

export function getCached(key: string, ttlKey: string): string | null {
  const e = toolCache.get(key); if (!e) return null
  if (Date.now() - e.ts > (CACHE_TTL[ttlKey] || CACHE_TTL.default)) { toolCache.delete(key); return null }
  return e.result
}
export function setCached(key: string, result: string) { toolCache.set(key, { result, ts: Date.now() }) }
export function onWriteOp() { for (const k of toolCache.keys()) { if (/^(read|ls|grep|find):/.test(k)) toolCache.delete(k) } try { window.huangquan.computer?.invalidateCache?.() } catch {} }

export let taskGen = 0
export function nextTaskGen(): number { return ++taskGen }

// dispatch 参数解析容错: 兼容 数组 / {tasks:[...]} / JSON 字符串 三种模型传参风格
export function parseDispatchTasks(raw: unknown): { agent: string; task: string }[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) return parsed as { agent: string; task: string }[]
    if (parsed && Array.isArray((parsed as { tasks?: unknown }).tasks)) return (parsed as { tasks: { agent: string; task: string }[] }).tasks
  } catch { /* 忽略 */ }
  return []
}

function matchWorkflow(txt: string): string | null {
  const t = txt.toLowerCase()
  const matches = Object.entries(WORKFLOWS).map(([id, w]) => ({ id, score: w.triggers.filter(tr => t.includes(tr.toLowerCase())).length })).filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  return matches[0]?.id || null
}


function normPath(p: string): string {
  const norm = String(p || '').replace(/\\/g, '/')
  const isAbs = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')
  const parts: string[] = []
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (isAbs ? '/' : '') + parts.join('/')
}

// 文件权限检查

function checkFilePermission(name: string, args: Record<string, unknown>): string | null {
  const perm = useSettingsStore.getState().general.filePermission || 'full'
  if (perm === 'full') return null
  const wd = useSettingsStore.getState().general.workDir || ''
  const p = String(args.path || args.dirPath || '')
  // sandbox: 仅在 working directory 内允许操作 —— 规范化路径后再比较, 防 .. 穿越绕过
  if (perm === 'sandbox' && wd && p) {
    const rp = normPath(p).toLowerCase()
    const rw = normPath(wd).toLowerCase()
    if (!(rp === rw || (rw && rp.startsWith(rw + '/')))) {
      return 'E:permission denied (sandbox): path outside work directory'
    }
  }
  // readonly: 禁止写/删/执行
  if (perm === 'readonly' && ['write','edit','mkdir','exec_command','codebox'].includes(name)) {
    return 'E:permission denied (readonly): ' + name + ' not allowed'
  }
  // ask: 写操作需确认（实现为拒绝 + 提示）
  if (perm === 'ask' && ['write','edit','mkdir','exec_command','codebox'].includes(name)) {
    return 'E:permission denied (ask): ' + name + ' requires manual confirmation. Use settings to change permission level.'
  }
  return null
}


// 工具开关——从设置读取禁用列表，过滤 TOOLS

export function getActiveTools(agentName?: string): ToolSpec[] {
  const raw = useSettingsStore.getState().general.disabledTools
  // 未显式配置时默认禁用高风险 workflow 工具(LLM 输出直接执行 JS, 已限 8KB+严格模式, 仍需人工开启)
  const disabled: string[] = raw === undefined ? ['workflow'] : (raw || [])
  // v0.3.0 M4: 插件工具并入(有 index.js 实现的插件, plugin_ 前缀防冲突)
  const merged = [...TOOLS, ...PLUGIN_TOOLS]
  // v0.3.2 T1: 角色白名单裁剪(主请求; 子任务在 subtask.ts 用同一函数, 过滤基为 TOOLS 不含插件——现状保持)
  // v0.3.5 T2: toolWhitelist 开关关闭时返回全量(0.3.1 行为)
  // ⚠ 顺序锁定: filter 保序(TOOLS 原序 + PLUGIN_TOOLS 原序) —— 禁止 sort/Set 去重, 破坏顺序会打断供应商前缀缓存
  const filtered = agentName && useSettingsStore.getState().general.perf?.toolWhitelist !== false ? filterToolsByAgent(merged, agentName) : merged
  // 协作模式=关闭 时彻底禁用多角色协作工具(handoff/dispatch/list_agents)
  const collabMode = String(useSettingsStore.getState().general.collabMode || '自动')
  // v0.3.0: 媒体自动调用开关(策略页可调) —— 关闭则不注入生成工具
  const g0 = useSettingsStore.getState().general
  if (g0.autoMediaImg === false) disabled.push('media_img')
  if (g0.autoMediaVideo === false) disabled.push('media_video')
  if (collabMode === '关闭') {
    return filtered.filter(t => !disabled.includes(t.function.name) && !['handoff', 'dispatch', 'list_agents'].includes(t.function.name))
  }
  if (disabled.length === 0) return filtered
  return filtered.filter(t => !disabled.includes(t.function.name))
}


// v0.3.0 FIX-E: 视觉候选单一来源 —— ref:/供应商::模型/裸模型名 三格式, 优先级=配置顺序, 去重, 空配置自动兜底
export interface VisionCandidate { vp: ProviderConfig | MediaProvider; vm: string; label: string }
export function buildVisionCandidates(p: ProviderConfig | MediaProvider): VisionCandidate[] {
  const g = useSettingsStore.getState().general
  const all = useSettingsStore.getState().providers
  const allMedia = useSettingsStore.getState().mediaProviders || []
  const pool = [
    ...all.map(pr => ({ p: pr, models: pr.models || [] })),
    ...allMedia.map(mp => ({ p: { ...mp, type: 'OpenAI Compatible' }, models: [...(mp.imgModels || []), ...(mp.videoModels || []), ...(mp.audioModels || [])] })),
  ]
  const out: VisionCandidate[] = []
  const pushByRef = (id: string) => {
    const pid = id.slice(4)
    const hit = pool.find(x => x.p.id === pid || x.p.name === pid)
    if (hit) { const m = hit.models.find(isVisionModel) || hit.models[0]; if (m && !out.some(c => c.vm === m && c.vp === hit.p)) out.push({ vp: hit.p, vm: m, label: hit.p.name + '::' + m }) }
  }
  const pushByName = (pid: string, mname: string) => {
    const hit = pool.find(x => x.p.name === pid)
    if (hit && hit.models.includes(mname) && !out.some(c => c.vm === mname)) out.push({ vp: hit.p, vm: mname, label: hit.p.name + '::' + mname })
  }
  const pushByModel = (mname: string) => {
    const hit = pool.find(x => x.models.includes(mname))
    if (hit && !out.some(c => c.vm === mname)) out.push({ vp: hit.p, vm: mname, label: hit.p.name + '::' + mname })
  }
  const visList: string[] = Array.isArray(g.visionModels) ? g.visionModels.filter(Boolean) : []
  for (const item of visList) {
    if (item.startsWith('ref:')) pushByRef(item)
    else if (item.includes('::')) { const [a, b] = item.split('::'); pushByName(a, b) }
    else pushByModel(item)
  }
  // 旧单值 visionModel 追加末尾(不重复)
  if (g.visionModel && !visList.includes(g.visionModel)) {
    if (g.visionModel.startsWith('ref:')) pushByRef(g.visionModel)
    else if (!g.visionModel.includes('::')) pushByModel(g.visionModel)
  }
  // 自动兜底: 当前 provider → 池中第一个视觉模型
  if (!out.length) {
    const inProv = ('models' in p ? (p.models || []) : []).find(isVisionModel)
    if (inProv) out.push({ vp: p, vm: inProv, label: p.name + '::' + inProv })
    else for (const item of pool) { const m = item.models.find(isVisionModel); if (m) { out.push({ vp: item.p, vm: m, label: item.p.name + '::' + m }); break } }
  }
  return out
}

export async function analyzeWithVision(p: ProviderConfig | MediaProvider, images: string[], text: string): Promise<string> {
  try {
    const candidateList = buildVisionCandidates(p)
    if (!candidateList.length) return 'E:no-vision-model'
    const errors: string[] = []
    // v0.3.0 FIX-D: 部分成功策略 —— 单张失败不丢弃其他成功结果, 不重试
    for (const cand of candidateList) {
      const descs: string[] = []
      const failIdx: number[] = []
      let candErr = ''
      for (let i = 0; i < images.length; i++) {
        const r = await window.huangquan.llm.vision({
          provider: cand.vp.type || 'OpenAI Compatible', model: cand.vm, apiKey: cand.vp.apiKey || '', baseUrl: cand.vp.baseUrl || '',
          imageDataUrl: images[i],
          prompt: '请用中文详细描述这张图片的内容（包括其中的文字、图表、界面元素、关键细节等）。' + (text ? '用户的问题是：' + text : ''),
        })
        if (r && !r.startsWith('E:')) descs.push(r)
        else { failIdx.push(i); candErr = (r || '').replace(/^E:/, '') || '未知错误' }
      }
      // 部分成功: 成功结果保留 + 失败图数说明
      if (descs.length > 0) {
        return descs.join('\n') + (failIdx.length ? '\n[其中 ' + failIdx.length + ' 张图分析失败: ' + candErr + ']' : '')
      }
      errors.push(cand.label + ': ' + (candErr || '分析失败'))
    }
    // 全部候选失败
    return 'E:ALL_VISION_FAILED: ' + errors.join(' | ')
  } catch (e: unknown) { return 'E:' + (errMsg(e) || 'vision-error') }
}

export async function runTool(name: string, a: Record<string, unknown>, snapCfg?: SettingsData): Promise<string> {
  const A = a as unknown as Record<string, string>
  // v0.3.0 M3: 当前角色工具白名单过滤(主角色/handoff 场景; 子角色由 subtask 守卫)
  const curAg = useChatStore.getState().cur()?.agent || window.__huangquan_agent
  if (curAg) {
    const agDef = useAgents()[curAg]
    // 协作/基础工具恒放行(与 filterToolsByAgent 注入层一致): 专业角色也能 dispatch/handoff/session_search
    if (agDef && !agDef.tools.includes('*') && !['handoff', 'dispatch', 'list_agents', 'session_search'].includes(name) && !agDef.tools.includes(name)) return 'E:权限不足，该角色无权调用 ' + name
  }
  // v0.3.0 M4: 插件工具 —— plugin_<plugin>__<tool> → IPC vm 沙箱执行
  if (name.startsWith('plugin_')) {
    const rest = name.slice(7)
    const sep = rest.lastIndexOf('__')
    if (sep <= 0) return 'E:插件工具名格式错误: ' + name
    const plugin = rest.slice(0, sep)
    const tool = rest.slice(sep + 2)
    try { return await window.huangquan.plugins.exec(plugin, tool, a || {}) } catch (e: unknown) { return 'E:插件执行异常: ' + (errMsg(e)) }
  }
  try {
    // 文件权限检查
    const permErr = checkFilePermission(name, a)
    if (permErr) return permErr
    // 每工具权限表(ToolsView 配置)接入 —— IPC API 名 → agent 工具名映射
    // ToolsView 的 BUILTIN_TOOLS 用 IPC 名(readFile/exec...), runTool 用 agent 名(read/exec_command...), 不映射则权限设置部分失效
    try {
      // 工具权限: 优先设置存储(general.toolPerms); 兼容 localStorage 旧数据(有值则作为初始来源)
      let perms = useSettingsStore.getState().general.toolPerms || {}
      if (!Object.keys(perms).length) {
        try { const old = JSON.parse(localStorage.getItem('huangquan_tool_perms') || '{}') as Record<string, string>; if (Object.keys(old).length) perms = old } catch { perms = {} }
      }
      const IPC_TO_TOOL: Record<string, string> = { readFile: 'read', writeFile: 'write', readDir: 'ls', exec: 'exec_command', systemInfo: 'system_info', processList: 'process_list', killProcess: 'kill_process', clipboardRead: 'clipboard_read', clipboardWrite: 'clipboard_write', cron_task: 'schedule_task', browse: 'web_read', browse_screenshot: 'web_read' }
      const ipcKey = Object.keys(IPC_TO_TOOL).find(k => IPC_TO_TOOL[k] === name)
      const lv = perms[name] || (ipcKey ? perms[ipcKey] : undefined)
      if (lv === 'deny') return 'E:permission denied: ' + name + ' 已被禁止(可在 设置→工具→权限 中修改)'
      if (lv === 'ask') return 'E:permission denied: ' + name + ' 需要手动确认(可在 设置→工具→权限 中改为允许后重试)'
    } catch (e) { /* localStorage 不可用则忽略 */ console.debug('[swallow]', e) }
    // v0.2: cache
    const ck = name + ':' + JSON.stringify(a || {})
    const cached = getCached(ck, name)
    // 缓存命中统计 —— 按当前会话 + 按当前模型 双维度
    {
      const st = useChatStore.getState()
      const sid = st.cid
      const mdl = st.curModel
      if (sid) {
        useChatStore.setState(s => {
          const c = s.sessCache[sid] || { hits: 0, misses: 0 }
          const sess = { ...s.sessCache, [sid]: cached ? { hits: c.hits + 1, misses: c.misses } : { hits: c.hits, misses: c.misses + 1 } }
          // 按模型统计(未使用的模型不会出现)
          let modelPart = s.modelCache
          if (mdl) {
            const m = s.modelCache[mdl] || { hits: 0, misses: 0 }
            modelPart = { ...s.modelCache, [mdl]: cached ? { hits: m.hits + 1, misses: m.misses } : { hits: m.hits, misses: m.misses + 1 } }
          }
          return { sessCache: sess, modelCache: modelPart }
        })
      }
    }
    if (cached) return cached + ' [cache]'
    if (['write','edit','mkdir','exec_command'].includes(name)) onWriteOp()
    switch (name) {
      // read 支持主进程分段读(offset/limit 透传, 修复 >5MB 文件无法续读)
      case 'read': { if (!A.path) return 'E:need path'; const c = await window.huangquan.computer.readFile(A.path, A.offset ? Number(A.offset) : undefined, A.limit ? Number(A.limit) : undefined); if (A.offset) return c; return (c.length > 8000 ? c.slice(0, 8000) + '\n...[已截断, 共 ' + c.length + ' 字符, 如需后续内容用 read offset=' + (c.slice(0, 8000).split('\n').length + 1) + ' 续读]' : c) }
      case 'write': { if (!A.path || A.content === undefined) return 'E:need path+content'; await window.huangquan.computer.writeFile(A.path, A.content); return A.path + ' (' + A.content.length + ' chars)' }
      case 'edit': { if (!A.path || !A.oldText) return 'E:need path+oldText+newText'; const o = await window.huangquan.computer.readFile(A.path); if (!o.includes(A.oldText)) return 'E:text not found in ' + A.path; await window.huangquan.computer.writeFile(A.path, o.replace(A.oldText, A.newText || '')); return A.path + ' (edited)' }
      case 'exec_command': { if (!A.cmd) return 'E:need cmd'; const r = await window.huangquan.computer.exec(A.cmd); const out = r || '(empty output)'; return out.length > 3000 ? out.slice(0, 1500) + '\n...[输出过长已截断, 共 ' + out.length + ' 字符, 头尾已保留]\n' + out.slice(-1500) : out }
      // mkdir 走主进程 IPC(带工作目录校验 + 防 shell 注入), 不再拼 exec
      case 'mkdir': { if (!A.path) return 'E:need path'; const r = await window.huangquan.computer.mkdir(A.path); if (!r?.ok) return 'E:mkdir failed: ' + (r?.error || 'unknown'); return A.path + ' (created)' }
      case 'grep': { if (!A.dirPath || !A.pattern) return 'E:need dirPath+pattern'; return await window.huangquan.computer.grep(A.dirPath, A.pattern) || '(no matches)' }
      case 'find': { if (!A.dirPath || !A.glob) return 'E:need dirPath+glob'; return await window.huangquan.computer.find(A.dirPath, A.glob) || '(no files found)' }
      case 'ls': { const wd = useSettingsStore.getState().general.workDir; const items = await window.huangquan.computer.readDir(A.dirPath || wd || '.'); return items.length ? items.map(i => (i.isDirectory ? '[DIR]' : '[FILE]') + ' ' + i.name + ' (' + i.size + 'B)').join('\n') : '(empty directory)' }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': { if (!A.query) return 'E:need query'; return await window.huangquan.web.search(A.query) || '(none)' }
      case 'web_fetch': return await window.huangquan.web.fetch(A.url || 'about:blank')
      case 'web_read': {
        if (!A.url) return 'E:need url'
        // 总开关本地兜底(主进程也会校验)
        const g = useSettingsStore.getState().general
        if (g.webReadEnabled === false) return 'E:web_read 已被禁用, 请在 设置 → 工具 → 无头浏览器网页解析工具 中开启'
        try {
          const raw = await window.huangquan.web.read(A.url, A.mode || 'text')
          const r = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (!r.ok) return 'E:' + (r.error || '读取失败') + (r.advice ? ' | 建议: ' + r.advice : '')
          if (A.mode === 'screenshot' && r.screenshotBase64) return '截图完成(已保存到会话): ' + r.screenshotBase64
          if (A.mode === 'pdf' && r.pdfBase64) return 'PDF 生成完成(base64, 长度 ' + r.pdfBase64.length + ')'
          const body = r.text || '(空页面)'
          return (r.title ? '标题: ' + r.title + '\n' : '') + '\n正文:\n' + (body.length > 6000 ? body.slice(0, 6000) + '\n...[正文过长已截断, 共 ' + body.length + ' 字符]' : body)
        } catch (e: unknown) { return 'E:web_read 异常: ' + errMsg(e) }
      }
      case 'browse': { if (!A.url) return 'E:need url'; return await window.huangquan.web.browse(A.url) }
      case 'browse_screenshot': { if (!A.url) return 'E:need url'; return await window.huangquan.web.browseScreenshot(A.url) }
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'clipboard_read': return await window.huangquan.computer.clipboardRead()
      case 'clipboard_write': { if(!A.text)return'E:need text';await window.huangquan.computer.clipboardWrite(A.text);return'ok:clipped' }
      case 'process_list': return await window.huangquan.computer.processList()
      case 'kill_process': { if(!A.pid)return'E:need pid';return await window.huangquan.computer.killProcess(A.pid) }
      // 相同事实去重(重复调用不再累积)
      case 'save_memory': {
        const m = await window.huangquan.memory.load(); const fact = String(A.fact || '').trim(); if (!fact) return 'E:need fact'
        // 记忆安全扫描(凭证/注入拒绝落盘)
        const scan = scanMemoryText(fact)
        if (!scan.ok) return 'E:' + scan.reason
        const pf = (m.pinnedFacts || []) as string[]; if (pf.some(f => String(f).trim() === fact)) return 'ok:already saved'; m.pinnedFacts = [...pf, fact]; await window.huangquan.memory.save(safeIPC(m) as Record<string, unknown>); return 'ok:pinned'
      }
      // recall_memory 接入向量语义检索(主进程 TF-IDF) + 关键词匹配合并
      case 'recall_memory': {
        const query = (A.query || '').trim()
        const m = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
        const pinned = (m.pinnedFacts || []) as string[]
        const facts = (m.facts || []) as string[]
        const snippets = (m.summaries || []) as { content: string }[]
        const q = query.toLowerCase()
        // 关键词命中(置顶 1.5 / 长期 1.0 / 摘要 0.8)
        const kwItems = [...pinned.map(f => ({ content: String(f), score: 1.5 })), ...facts.map(f => ({ content: String(f), score: String(f).toLowerCase().includes(q) ? 1.0 : 0 })), ...snippets.map(s => ({ content: String(s.content || ''), score: (s.content || '').toLowerCase().includes(q) ? 0.8 : 0 }))]
        const kwHits = q ? kwItems.filter(r => r.content.toLowerCase().includes(q)).sort((a, b) => b.score - a.score) : kwItems
        // 向量语义检索(主进程, 失败静默)
        let vecHits: { content: string; score: number }[] = []
        try {
          const v = await window.huangquan.memory.search(query)
          if (Array.isArray(v)) vecHits = v.map((x: { content?: string }) => ({ content: String(x.content || ''), score: 0.5 }))
        } catch (e) { /* 向量检索不可用则忽略 */ console.debug('[swallow]', e) }
        // 合并去重
        const seen = new Set<string>()
        const merged = [...vecHits, ...kwHits].filter(r => {
          if (!r.content || seen.has(r.content)) return false
          seen.add(r.content)
          return true
        }).slice(0, 10)
        return merged.length ? merged.map((r: { content: string }, i: number) => (i + 1) + '. ' + r.content).join('\n---\n') : '(empty)'
      }
      // 会话全文关键词搜索(跨会话回忆)
      case 'session_search': {
        const q = String(A.query || '').trim()
        if (!q) return 'E:need query'
        const r = await window.huangquan.sessions.search(q, A.limit ? Number(A.limit) : 5)
        return r.length ? r.map((x: { title: string; role: string; snippet: string; ts: number }, i: number) => `${i + 1}. [${x.title}](${x.role}) ${new Date(x.ts).toLocaleDateString('zh-CN')} ${x.snippet}`).join('\n---\n') : '(no matches)'
      }
      case 'codebox': { if (!A.lang || !A.code) return 'E:need lang+code'; return await window.huangquan.computer.codebox(A.lang, A.code) }
      case 'import_doc': { if (!A.path) return 'E:need path'; const ok = await window.huangquan.memory.importFile(A.path).catch(() => false); return ok ? 'ok:imported' : 'E:import failed' }
      case 'schedule_task': { if (!A.expression || !A.prompt) return 'E:need expression+prompt'; const cr = await window.huangquan.cron.add(A.expression, A.prompt); return JSON.stringify(cr) }
      case 'list_schedules': { const items = await window.huangquan.cron.list(); return items.length ? (items as { enabled?: boolean; expression: string; prompt: string }[]).map((j: { enabled?: boolean; expression: string; prompt: string }, i: number) => (i+1) + '. [' + (j.enabled?'on':'off') + '] ' + j.expression + ' - ' + j.prompt).join(' | ') : '(empty)' }
      case 'mcp_connect': { if (!A.name||!A.command) return 'E:need name+command'; const r = await window.huangquan.mcpConnect(A.name, A.command, A.args ? A.args.split(' ') : []); return typeof r==='string'?r:JSON.stringify(r) }
      case 'mcp_call': { if (!A.server||!A.tool) return 'E:need server+tool'; const mc = await window.huangquan.mcpCall(A.server, A.tool, (A.args || '{}') as unknown as Record<string, unknown>); return typeof mc === 'string' ? mc : JSON.stringify(mc) }
      case 'set_workdir': { if (!A.path) return 'E:need path'; try { await window.huangquan?.computer.setWorkDir(A.path) } catch (e) { /* ignore */ console.debug('[swallow]', e) }; return '工作目录已设为(本次会话): ' + A.path }
      case 'set_theme': { if (!A.theme) return 'E:need theme'; useSettingsStore.getState().setTheme(A.theme); document.documentElement.setAttribute('data-theme', A.theme); return '主题已切换为: ' + A.theme }
      // v0.2: 多角色/工作流
      case 'handoff': { const agents = useAgents(); if (!A.agent_name) return 'E:缺少角色名'; const ag = agents[A.agent_name]; if (!ag) return 'E:未知角色: ' + A.agent_name + ' (可用: ' + Object.keys(agents).join(', ') + ')'; const dAgents: string[] = useSettingsStore.getState().general.disabledAgents || []; if (dAgents.includes(A.agent_name)) return 'E:该角色已被禁用: ' + A.agent_name + ' (设置→协作 中可重新启用)'; useChatStore.setState(s => ({ sessions: s.sessions.map(x => x.id === s.cid ? { ...x, agent: A.agent_name, agentManual: false } : x) })); useChatStore.setState(s => ({ activeAgents: s.activeAgents.includes(A.agent_name) ? s.activeAgents : [...s.activeAgents, A.agent_name] })); return `✅ 已交接给 ${A.agent_name}(${ag.role})。原因: ${A.reason || '能力边界外'}。现在你以 ${A.agent_name} 的身份继续执行。\n\n【${A.agent_name} 身份】${ag.prompt}` }
      case 'list_agents': { return Object.entries(useAgents()).map(([n,ag]) => `${ag.icon} **${n}** (${ag.role}): ${ag.prompt.slice(0,80)}... | 工具: ${ag.tools.join(', ')}`).join('\n\n') }
      // 任务分发 —— 并行分发给多个子角色独立执行（chatOnce 非流式），真正实现多角色协作
      case 'dispatch': {
        // 参数容错: 兼容 数组 / {tasks:[...]} / JSON 字符串 三种格式(DeepSeek 等模型传参风格不一)
        const dTasks = parseDispatchTasks(A.tasks ?? A.plan ?? '[]')
        // dispatch 总超时护栏(90s): 子任务 LLM 挂起时强制返回, 防止工具循环永久等待
        const dispatchPromise = runDispatch(dTasks, snapCfg, () => taskGen, runTool)
        const dispatchTimeout = new Promise<string>(resolve => setTimeout(() => resolve('E:dispatch 超时(90s)，部分子任务未完成，请重试或检查网络'), 90000))
        return await Promise.race([dispatchPromise, dispatchTimeout])
      }
      case 'list_workflows': { return Object.entries(WORKFLOWS).map(([id,w]) => `- **${id}** (${w.name}): 触发词 → ${w.triggers.slice(0,3).join(', ')}; ${w.steps.length} 步骤`).join('\n') }
      case 'run_workflow': { if (!A.workflow_id) return 'E:need workflow_id'; const wf = WORKFLOWS[A.workflow_id]; if (!wf) return 'E:unknown workflow: ' + A.workflow_id; let vars: Record<string, string> = {}; try { vars = JSON.parse(A.variables || '{}') } catch { vars = {} }; const steps = wf.steps.map((s,i) => `${i+1}. ${s.desc} → \`${s.tool}(${s.args_template.replace(/\{(\w+)\}/g,(_:string,k:string)=>vars[k]||`{${k}}`)})\``).join('\n'); return `工作流 **${wf.name}** (${wf.steps.length}步):\n${steps}\n\n请按顺序执行以上步骤，每步完成后验证结果。` }
      case 'read_image': { if (!A.path) return 'E:need path'; return await window.huangquan.computer.readImageBase64(A.path) }
      case 'media_img': { if (!A.prompt) return 'E:need prompt'; const r = await window.huangquan.mediaGen({ kind: 'img', prompt: String(A.prompt), ratio: A.ratio ? String(A.ratio) : undefined }); return r.ok ? ('图片已生成: ' + (r.path || '')) : ('生成失败: ' + (r.error || '')) }
      case 'media_video': { if (!A.prompt) return 'E:need prompt'; const r = await window.huangquan.mediaGen({ kind: 'video', prompt: String(A.prompt), duration: A.duration ? Number(A.duration) : undefined }); return r.ok ? ('视频已生成: ' + (r.path || '')) : ('生成失败: ' + (r.error || '')) }
      case 'show_card': { if (!A.html) return 'E:need html'; return '<!--CARD' + (A.title ? ':' + A.title : '') + '-->' + A.html + '<!--/CARD-->' }
      case 'bridge_notify': { const g = useSettingsStore.getState().general; if (g.notifyEnabled === false) return 'ok:notifications disabled'; const kind = A.type || 'info'; if (kind === 'task_done' && g.notifyTaskDone === false) return 'ok:task_done notifications disabled'; if (kind === 'error' && g.notifyError === false) return 'ok:error notifications disabled'; try { new Notification(A.title || '黄泉Agent', { body: A.body || '' }) } catch {} return 'ok:notified' }
      // workflow 脚本加固 —— 限长 8KB、严格模式、隔离 window 访问, 防提示注入直接操纵宿主
      // v0.3.1 补丁: 超时兜底(30s) + Promise/普通返回值统一收尾, 防脚本不调 done 导致工具循环永久挂起
      case 'workflow': {
        if (!A.script) return 'E:need script'
        if (String(A.script).length > 8192) return 'E:workflow script too long (max 8KB)'
        return new Promise(resolve => {
          const logs: string[] = []
          let settled = false
          const timeout = setTimeout(() => finish('E:workflow timeout (30s)'), 30000)
          const finish = (r: unknown) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(String(r)) }
          const ctx = {
            log: (msg: unknown) => { logs.push(String(msg)); if (logs.length > 200) logs.shift() },
            tools: { run: async (n: string, args: Record<string, unknown>) => { logs.push('[wf] ' + n); return await runTool(n, args, snapCfg) } },
            done: (r: unknown) => finish(JSON.stringify({ result: r, logs }, null, 2)),
          }
          try {
            const fn = new Function('ctx', '"use strict"; ' + A.script)
            const ret = fn(ctx)
            if (ret instanceof Promise) {
              ret.then(v => finish(JSON.stringify({ result: v, logs }, null, 2))).catch(e => finish('E:workflow error: ' + errMsg(e)))
            } else if (!settled) {
              // 脚本未调用 done 也未返回 Promise —— 以返回值收尾, 防止永久挂起
              finish(JSON.stringify({ result: ret ?? null, logs }, null, 2))
            }
          } catch (e) { finish('E:workflow error: ' + errMsg(e)) }
        })
      }
      // 情景记忆 + 审计 + 目标持久化
      case 'audit_log': {
        const mem = await window.huangquan.memory.load().catch(() => ({ episodic: [] }))
        const log = (mem.episodic || []).slice(-(Number(A.limit || 20)))
        return log.length ? log.map((e: { status: string; ts: number; op: string; path?: string }, i: number) => `${i + 1}. [${new Date(e.ts).toLocaleString('zh-CN')}] ${e.op} ${e.path || ''} → ${e.status}`).join('\n') : '(无操作记录)'
      }
      case 'watch_file': {
        if (!A.path) return 'E:need path'
        const watchKey = A.path
        const prevState = watchState
        try {
          const content = await window.huangquan.computer.readFile(A.path)
          // 强哈希(内容全量), 修复弱哈希误判(同长同前缀内容变化不识别)
          let hash = ''
          try { hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32)) } catch { hash = content.length + ':' + content.slice(0, 200) }
          if (prevState[watchKey] && prevState[watchKey] !== hash) {
            const old = prevState[watchKey]; prevState[watchKey] = hash
            return `CHANGED: ${A.path} (hash: ${old.slice(0, 16)}... → ${hash.slice(0, 16)}...)`
          }
          prevState[watchKey] = hash
          return `WATCHING: ${A.path} (${content.length} bytes). Call again to detect changes.`
        } catch (e: unknown) { return 'E:watch failed: ' + errMsg(e) }
      }
      case 'save_goal': {
        const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
        const goals = mem.goals || []
        goals.push({ goal: A.goal, steps: A.steps ? JSON.parse(A.steps) : [], created: Date.now(), status: 'active' })
        mem.goals = goals
        await window.huangquan.memory.save(mem)
        return 'ok:goal_saved (' + goals.length + ' goals total)'
      }
      case 'list_goals': {
        const mem = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [], episodic: [], goals: [] }))
        const goals = mem.goals || []
        return goals.length ? goals.map((g: { goal: string; status: string; steps?: unknown[]; created?: number }, i: number) => `${i + 1}. [${g.status}] ${g.goal} (${(g.steps || []).length} steps, ${new Date(g.created || 0).toLocaleDateString('zh-CN')})`).join('\n') : '(无持久化目标)'
      }
      default: return 'E:unknown:' + name
    }
  } catch (e: unknown) { return 'E:' + errMsg(e) }
}

// 情景记忆——自动记录文件操作到审计日志
// 写盘防抖 —— 500ms 合并批量工具操作, 避免每次工具调用全量读写 memory.json
