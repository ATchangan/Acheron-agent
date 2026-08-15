// electron/engine/tool-handlers.ts — 声明式工具执行器(每个工具一个 handler, 与 schema/分发器分离)
import { spawn, type ChildProcess } from 'child_process'
import * as fs from 'fs'
import { join } from 'path'
import { Notification } from 'electron'
import { invokeHandler } from './registry'
import { WORKFLOWS } from './constants'
import type { ToolHandler, ToolRunCtx } from './tool-types'
import { scanMemoryText, recallFromMemory, upsertFactDb, recallMemoryDb } from './memory'
import { errMsg } from './errmsg'
import { applyPatchToContent } from '../shared/patch-utils'
import { getMcpToolSpecs } from './tool-specs'
import { checkFilePermission } from './tool-permission'
import { resolveSkillFile, safeSkillName, writableSkillDir, listSkills } from './skill-files'
import { getPowerShellCmd, getPowerShellIsPwsh } from '../shared/pwsh'
import { getToolOutput, queryAudit, setMemoryEmbedding } from '../db'
import { formatFusedHits } from '../memory/searcher'
import { embedText } from '../memory/embeddings'
import { searchSessions } from '../memory/session-index'
import { requestRiskConfirm } from '../ipc/risk-confirm'
import { validatePluginCode, validatePluginSettings, installPlugin, removePlugin, readPluginSource, listPluginDetails, invalidatePluginToolSpecCache, bustAllPluginCaches, isPluginDisabled } from '../plugins/author'
import type { UiDisplayConfig } from '../shared/settings-types'
import { sanitizeGeneralPatch, sanitizeProvidersPatch, redactSettings } from '../shared/settings-patch'
import { writeFileAtomicIfChanged } from '../fs-atomic'

const iconv = require('iconv-lite') as { encode: (s: string, enc: string) => Buffer; decode: (b: Buffer, enc: string) => string }

// ─── 会话化终端(长驻进程, 保持工作目录/状态) ───
interface TerminalSession { proc: ChildProcess; chunks: Buffer[]; enc: 'gbk' | 'utf8'; lastActive: number }
const terminalSessions = new Map<string, TerminalSession>()
const TERMINAL_IDLE_MS = 30 * 60 * 1000 // v0.3.7: 空闲 30 分钟自动关闭, 防止残留进程
function sweepTerminalSessions(): void {
  const now = Date.now()
  for (const [key, sess] of [...terminalSessions]) {
    if (now - sess.lastActive > TERMINAL_IDLE_MS) terminalClose(key)
  }
}
function terminalKey(sid: string, id: string): string { return sid + '::' + id }
function terminalRead(sess: TerminalSession): string {
  const s = sess.chunks.length ? iconv.decode(Buffer.concat(sess.chunks), sess.enc) : ''
  sess.chunks = []
  return s
}
function terminalWrite(sess: TerminalSession, text: string): void {
  try { sess.proc.stdin?.write(iconv.encode(text, sess.enc)) } catch { /* 忽略 */ }
}
function terminalClose(key: string): void {
  const sess = terminalSessions.get(key)
  if (!sess) return
  try { sess.proc.stdin?.end() } catch { /* 忽略 */ }
  try { sess.proc.kill() } catch { /* 忽略 */ }
  terminalSessions.delete(key)
}
export function closeTerminalSessions(sid?: string): void {
  for (const key of [...terminalSessions.keys()]) {
    if (!sid || key.startsWith(sid + '::')) terminalClose(key)
  }
}

const watchState: Record<string, string> = {}
// M7: 会话内 recall_tool_output 取回次数上限(防止反复取回刷爆窗口)
const recallOutputCounts = new Map<string, number>()

function parseDispatchTasks(raw: unknown): { agent: string; task: string }[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (Array.isArray(parsed)) return parsed as { agent: string; task: string }[]
    if (parsed && Array.isArray((parsed as { tasks?: unknown }).tasks)) return (parsed as { tasks: { agent: string; task: string }[] }).tasks
  } catch { /* 忽略 */ }
  return []
}

// workflow 工具递归调用 runTool: 通过引用注入, 避免模块循环依赖
let runToolRef: ((name: string, a: Record<string, unknown>, ctx: ToolRunCtx) => Promise<string>) | null = null
export function setRunToolRef(fn: (name: string, a: Record<string, unknown>, ctx: ToolRunCtx) => Promise<string>): void { runToolRef = fn }

// ─── v0.3.7: 工具 handler 注册表(声明式) ───
export const TOOL_HANDLERS: ToolHandler[] = [
  { name: 'read_skill', run: async (A, ctx) => {
    const name = String(A.name || '').trim()
    if (!name) return 'E:need name'
    const p = resolveSkillFile(ctx.skillsDirs || [], name, String(A.file || 'SKILL.md'))
    if (!p) return 'E:技能不存在或文件越权: ' + name + '/' + (A.file || 'SKILL.md')
    try {
      const content = fs.readFileSync(p, 'utf-8')
      const scan = scanMemoryText(content)
      const warn = scan.ok ? '' : '[安全扫描警告] ' + scan.reason + '\n\n'
      return warn + (content.length > 12000 ? content.slice(0, 12000) + '\n...[技能内容过长已截断, 共 ' + content.length + ' 字符]' : content)
    } catch (e: unknown) { return 'E:技能读取失败: ' + errMsg(e) }
  } },
  { name: 'skill_manage', run: (A, ctx) => {
    const action = String(A.action || '').trim()
    const name = String(A.name || '').trim()
    const dirs = ctx.skillsDirs || []
    if (!dirs.length) return 'E:未配置技能目录'
    if (action === 'list') {
      const list = listSkills(dirs)
      return list.length ? list.map(s => '- ' + s.name + ': ' + s.description).join('\n') : '(empty)'
    }
    if (!['create', 'patch', 'read'].includes(action)) return 'E:action 仅支持 create/patch/read/list'
    const safeName = safeSkillName(name)
    if (!safeName) return 'E:技能名非法(不能为空或包含路径分隔符)'
    const p = resolveSkillFile(dirs, safeName, 'SKILL.md')
    if (action === 'read') {
      if (!p) return 'E:技能不存在: ' + safeName
      try {
        const content = fs.readFileSync(p, 'utf-8')
        const scan = scanMemoryText(content)
        const warn = scan.ok ? '' : '[安全扫描警告] ' + scan.reason + '\n\n'
        return warn + (content.length > 12000 ? content.slice(0, 12000) + '\n...[技能内容过长已截断]' : content)
      } catch (e: unknown) { return 'E:技能读取失败: ' + errMsg(e) }
    }
    if (action === 'create') {
      if (p) return 'E:技能已存在: ' + safeName + '（请用 patch 局部修订，避免整文件重写）'
      const content = String(A.content || '')
      if (!content.trim()) return 'E:need content'
      const scan = scanMemoryText(content)
      if (!scan.ok) return 'E:' + scan.reason
      const dir = writableSkillDir(dirs)
      if (!dir) return 'E:技能目录不可写'
      const target = join(dir, safeName, 'SKILL.md')
      try {
        fs.mkdirSync(join(dir, safeName), { recursive: true })
        fs.writeFileSync(target, content, 'utf-8')
        return 'ok:created ' + target
      } catch (e: unknown) { return 'E:技能创建失败: ' + errMsg(e) }
    }
    // patch —— 只传变更文本, 省 token 且保留技能其余内容
    if (!p) return 'E:技能不存在: ' + safeName
    const oldText = String(A.oldText || '')
    const newText = String(A.newText || '')
    if (!oldText) return 'E:need oldText'
    try {
      const content = fs.readFileSync(p, 'utf-8')
      if (!content.includes(oldText)) return 'E:oldText not found（请带上足够上下文）'
      const next = content.replace(oldText, newText)
      const scan = scanMemoryText(next)
      if (!scan.ok) return 'E:' + scan.reason
      fs.writeFileSync(p, next, 'utf-8')
      return 'ok:patched ' + p + '（变更 ' + oldText.length + ' → ' + newText.length + ' 字符）'
    } catch (e: unknown) { return 'E:技能修订失败: ' + errMsg(e) }
  } },
  { name: 'read', cacheable: true, run: async (A, ctx) => {
    if (!A.path) return 'E:need path'
    const c = String(await invokeHandler('computer:readFile', [A.path, A.offset ? Number(A.offset) : undefined, A.limit ? Number(A.limit) : undefined], ctx.sender))
    if (A.offset) return c
    return c.length > 8000 ? c.slice(0, 8000) + '\n...[已截断, 共 ' + c.length + ' 字符, 如需后续内容用 read offset=' + (c.slice(0, 8000).split('\n').length + 1) + ' 续读]' : c
  } },
  { name: 'update_plan', run: (A, ctx) => {
    if (!Array.isArray((A as unknown as Record<string, unknown>).steps) || !(A as unknown as Record<string, unknown[]>).steps.length) return 'E:need steps[]'
    if (!ctx.onPlanUpdate) return 'E:引擎未提供计划更新通道'
    return ctx.onPlanUpdate((A as unknown as { steps: { label?: string; status?: string; expected?: string; id?: string; tool?: string }[] }).steps)
  } },
  { name: 'write', writeOp: true, run: async (A, ctx) => {
    if (!A.path || A.content === undefined) return 'E:need path+content'
    const ok = await invokeHandler('computer:writeFile', [A.path, A.content, ctx.sid, ctx.taskId], ctx.sender)
    return ok === true ? A.path + ' (' + A.content.length + ' chars)' : 'E:写入失败: ' + String(ok)
  } },
  { name: 'edit', writeOp: true, run: async (A, ctx) => {
    if (!A.path || !A.oldText) return 'E:need path+oldText+newText'
    const o = String(await invokeHandler('computer:readFile', [A.path], ctx.sender))
    if (!o.includes(A.oldText)) return 'E:text not found in ' + A.path
    const ok = await invokeHandler('computer:writeFile', [A.path, o.replace(A.oldText, A.newText || ''), ctx.sid, ctx.taskId], ctx.sender)
    return ok === true ? A.path + ' (edited)' : 'E:edit failed'
  } },
  { name: 'apply_patch', writeOp: true, run: async (A, ctx) => {
    const hunks = (A as unknown as Record<string, unknown>).hunks
    if (!A.path || !Array.isArray(hunks) || !hunks.length) return 'E:need path+hunks'
    const o = String(await invokeHandler('computer:readFile', [A.path], ctx.sender))
    const patched = applyPatchToContent(o, hunks as { oldText: string; newText: string }[])
    if (!patched.ok) return 'E:apply_patch 部分失败: ' + patched.errors.join('; ')
    const ok = await invokeHandler('computer:writeFile', [A.path, patched.content, ctx.sid, ctx.taskId], ctx.sender)
    return ok === true ? A.path + ' (patched ' + hunks.length + ' hunks, ' + patched.content.length + ' chars)' : 'E:apply_patch 写入失败'
  } },
  { name: 'exec_command', writeOp: true, run: async (A, ctx) => {
    if (!A.cmd) return 'E:need cmd'
    const r = String(await invokeHandler('computer:exec', [A.cmd, ctx.sid, ctx.taskId, ctx.workDir], ctx.sender))
    const out = r || '(empty output)'
    return out.length > 3000 ? out.slice(0, 1500) + '\n...[输出过长已截断, 共 ' + out.length + ' 字符, 头尾已保留]\n' + out.slice(-1500) : out
  } },
  { name: 'git', writeOp: (A) => !['status', 'diff', 'log'].includes(String(A.action || '').trim().toLowerCase()), run: async (A, ctx) => {
    const action = String(A.action || '').trim()
    const allowed = ['status', 'diff', 'log', 'commit', 'stash', 'push', 'pull', 'checkout']
    if (!allowed.includes(action)) return 'E:action 仅支持 ' + allowed.join('/')
    const args = String(A.args || '').trim()
    // 只读 action 与写 action 分开标注, 方便后续权限控制
    const cmd = 'git ' + action + (args ? ' ' + args : '')
    return String(await invokeHandler('computer:exec', [cmd, ctx.sid, ctx.taskId, ctx.workDir], ctx.sender))
  } },
  { name: 'init_project_docs', writeOp: true, run: (A, ctx) => {
    const wd = ctx.workDir || ''
    if (!wd) return 'E:未设置工作目录'
    const target = join(wd, 'AGENTS.md')
    const existing = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.agents.md'].map(n => join(wd, n)).find(p => fs.existsSync(p))
    if (existing) return 'E:项目指令已存在(' + existing + ')。为避免覆盖，请手动修改，或先删除后再生成'
    const sections: string[] = []
    try {
      const readme = fs.readFileSync(join(wd, 'README.md'), 'utf-8')
      const head = readme.slice(0, 800).trim()
      if (head) sections.push('## 项目概览\n' + head)
    } catch { /* 无 README 跳过 */ }
    try {
      const pkg = JSON.parse(fs.readFileSync(join(wd, 'package.json'), 'utf-8')) as { scripts?: Record<string, string> }
      const scripts = Object.entries(pkg.scripts || {})
      if (scripts.length) sections.push('## 常用命令\n' + scripts.map(([k, v]) => '- `' + k + '`: ' + v).join('\n'))
    } catch { /* 无 package.json 跳过 */ }
    const tree: string[] = []
    try {
      for (const ent of fs.readdirSync(wd, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ['node_modules', 'dist', 'dist-electron', 'release', '.git'].includes(ent.name)) continue
        tree.push('- ' + ent.name + (ent.isDirectory() ? '/' : ''))
        if (ent.isDirectory()) {
          for (const sub of fs.readdirSync(join(wd, ent.name), { withFileTypes: true }).slice(0, 12)) {
            if (!sub.name.startsWith('.')) tree.push('  - ' + sub.name + (sub.isDirectory() ? '/' : ''))
          }
        }
      }
    } catch { /* 目录读取失败跳过 */ }
    if (tree.length) sections.push('## 目录结构\n' + tree.join('\n'))
    sections.push('## 约定\n- 本机为 Windows: 命令一律用 PowerShell 语法\n- 修改文件后必须运行验证命令（构建/测试/检查）再宣称完成\n- 按项目实际情况继续补充规则')
    const content = '# AGENTS.md\n\n自动生成的项目指令草稿，请按项目实际情况修改完善。\n\n' + sections.join('\n\n') + '\n'
    fs.writeFileSync(target, content, 'utf-8')
    return target + ' (已生成 ' + content.length + ' 字符草稿，请检查后继续使用)'
  } },
  { name: 'terminal_open', run: async (A, ctx) => {
    const id = String(A.id || '')
    if (!id) return 'E:need id'
    const shell = String(A.shell || 'powershell')
    if (!['powershell', 'cmd', 'node', 'python'].includes(shell)) return 'E:shell 仅支持 powershell/cmd/node/python'
    const perms = ctx.g.toolPerms || {}
    const execLv = perms['exec_command']
    if (execLv === 'deny') return 'E:permission denied: exec_command 已被禁止(终端同权限)'
    if (execLv === 'ask') return 'E:permission denied: exec_command 需要手动确认(终端同权限)'
    const permErr = checkFilePermission('exec_command', {}, ctx)
    if (permErr) return permErr
    const always = (ctx.g.riskAlwaysAllow || []) as string[]
    if (ctx.g.riskConfirm === true && !always.some(x => x === 'terminal_open' || x === 'exec_command' || x === '*')) {
      return 'E:交互终端会绕过风险确认。请在 设置→引擎 关闭「操作需人工确认」，或把 terminal_open 加入风险永久放行后重试'
    }
    const key = terminalKey(ctx.sid, id)
    if (terminalSessions.has(key)) terminalClose(key)
    const cwd = String(A.cwd || ctx.workDir || '')
    const opts = { cwd: cwd || undefined, windowsHide: true }
    let proc: ChildProcess
    let enc: 'gbk' | 'utf8' = 'gbk'
    // v0.3.8: 与 exec_command 同源 —— 有 PowerShell 7 时交互终端也用 pwsh(UTF-8), 否则 Windows PowerShell(GBK)
    if (shell === 'powershell') { proc = spawn(getPowerShellCmd(), ['-NoLogo', '-NoExit', '-Command', '-'], opts); enc = getPowerShellIsPwsh() ? 'utf8' : 'gbk' }
    else if (shell === 'cmd') proc = spawn('cmd.exe', [], opts)
    else if (shell === 'node') { proc = spawn('node', ['-i'], opts); enc = 'utf8' }
    else { proc = spawn('python', ['-X', 'utf8', '-u', '-i'], opts); enc = 'utf8' }
    const sess: TerminalSession = { proc, chunks: [], enc, lastActive: Date.now() }
    proc.stdout?.on('data', (d: Buffer) => { sess.chunks.push(d) })
    proc.stderr?.on('data', (d: Buffer) => { sess.chunks.push(d) })
    proc.on('exit', () => { if (terminalSessions.get(key) === sess) terminalSessions.delete(key) })
    proc.on('error', () => { if (terminalSessions.get(key) === sess) terminalSessions.delete(key) })
    terminalSessions.set(key, sess)
    sweepTerminalSessions()
    await new Promise(r => setTimeout(r, 600))
    const boot = terminalRead(sess)
    return 'ok:terminal ' + id + ' opened (' + shell + ')' + (cwd ? ' cwd=' + cwd : '') + (boot ? '\n' + boot.slice(0, 500) : '')
  } },
  { name: 'terminal_run', run: async (A, ctx) => {
    const id = String(A.id || '')
    const key = terminalKey(ctx.sid, id)
    const sess = terminalSessions.get(key)
    if (!sess || sess.proc.killed) return 'E:terminal not open: ' + id + ' (先 terminal_open)'
    const input = String(A.input ?? '')
    if (!input.trim()) return 'E:need input'
    const permErr = checkFilePermission('exec_command', { cmd: input }, ctx)
    if (permErr) return permErr
    terminalWrite(sess, input + '\n')
    sess.lastActive = Date.now()
    sweepTerminalSessions()
    const wait = Math.min(Math.max(Number(A.wait_ms) || 1500, 200), 15000)
    await new Promise(r => setTimeout(r, wait))
    const out = terminalRead(sess) || '(no output yet, 可增大 wait_ms 或再次 terminal_run)'
    return out.length > 3000 ? out.slice(0, 1500) + '\n...[输出过长已截断]\n' + out.slice(-1500) : out
  } },
  { name: 'terminal_close', run: (A, ctx) => {
    terminalClose(terminalKey(ctx.sid, String(A.id || '')))
    return 'ok:closed'
  } },
  { name: 'mkdir', writeOp: true, run: async (A, ctx) => {
    if (!A.path) return 'E:need path'
    const r = await invokeHandler('computer:mkdir', [A.path], ctx.sender) as { ok?: boolean; error?: string }
    return r?.ok ? A.path + ' (created)' : 'E:mkdir failed: ' + (r?.error || 'unknown')
  } },
  { name: 'grep', cacheable: true, run: async (A, ctx) => {
    if (!A.dirPath || !A.pattern) return 'E:need dirPath+pattern'
    return String(await invokeHandler('computer:grep', [A.dirPath, A.pattern], ctx.sender)) || '(no matches)'
  } },
  { name: 'find', cacheable: true, run: async (A, ctx) => {
    if (!A.dirPath || !A.glob) return 'E:need dirPath+glob'
    return String(await invokeHandler('computer:find', [A.dirPath, A.glob], ctx.sender)) || '(no files found)'
  } },
  { name: 'ls', cacheable: true, run: async (A, ctx) => {
    const items = await invokeHandler('computer:readDir', [A.dirPath || ctx.workDir || '.'], ctx.sender) as { name: string; isDirectory: boolean; size: number }[]
    return Array.isArray(items) ? items.map(i => (i.isDirectory ? '[DIR]' : '[FILE]') + ' ' + i.name + ' (' + i.size + 'B)').join('\n') : '(empty directory)'
  } },
  { name: 'system_info', run: async (A, ctx) => JSON.stringify(await invokeHandler('computer:systemInfo', [], ctx.sender), null, 2) },
  { name: 'web_search', run: async (A, ctx) => {
    if (!A.query) return 'E:need query'
    return String(await invokeHandler('web:search', [A.query], ctx.sender)) || '(none)'
  } },
  { name: 'web_fetch', run: async (A, ctx) => String(await invokeHandler('web:fetch', [A.url || 'about:blank'], ctx.sender)) },
  { name: 'web_read', run: async (A, ctx) => {
    if (!A.url) return 'E:need url'
    try {
      const raw = String(await invokeHandler('web:read', [A.url, A.mode || 'text'], ctx.sender))
      let r: { ok?: boolean; error?: string; advice?: string; text?: string; title?: string; screenshotBase64?: string; pdfBase64?: string }
      try { r = JSON.parse(raw) } catch { return raw.slice(0, 500) }
      if (!r.ok) return 'E:' + (r.error || '读取失败') + (r.advice ? ' | 建议: ' + r.advice : '')
      if (A.mode === 'screenshot' && r.screenshotBase64) return '截图完成(已保存到会话): ' + r.screenshotBase64
      if (A.mode === 'pdf' && r.pdfBase64) return 'PDF 生成完成(base64, 长度 ' + r.pdfBase64.length + ')'
      const body = r.text || '(空页面)'
      return (r.title ? '标题: ' + r.title + '\n' : '') + '\n正文:\n' + (body.length > 6000 ? body.slice(0, 6000) + '\n...[正文过长已截断, 共 ' + body.length + ' 字符]' : body)
    } catch { return 'E:web_read 返回异常' }
  } },
  { name: 'browse', run: async (A, ctx) => String(await invokeHandler('browser:snapshotA11y', [A.url, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browse_screenshot', run: async (A, ctx) => String(await invokeHandler('browser:screenshot', [A.url, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_click', run: async (A, ctx) => String(await invokeHandler('browser:click', [A.ref, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_type', run: async (A, ctx) => String(await invokeHandler('browser:type', [A.ref, A.text, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_press', run: async (A, ctx) => String(await invokeHandler('browser:press', [A.key, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_scroll', run: async (A, ctx) => String(await invokeHandler('browser:scroll', [A.direction, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_console', run: async (A, ctx) => String(await invokeHandler('browser:console', [A.expression, ctx.sid + '::' + ctx.taskId], ctx.sender)) },
  { name: 'browser_vision', run: () => 'E:browser_vision 由引擎视觉通道处理' },
  { name: 'screenshot', run: async (A, ctx) => String(await invokeHandler('computer:screenshot', [], ctx.sender)) },
  { name: 'clipboard_read', run: async (A, ctx) => String(await invokeHandler('computer:clipboardRead', [], ctx.sender)) },
  { name: 'clipboard_write', run: async (A, ctx) => {
    if (!A.text) return 'E:need text'
    await invokeHandler('computer:clipboardWrite', [A.text], ctx.sender)
    return 'ok:clipped'
  } },
  { name: 'process_list', run: async (A, ctx) => String(await invokeHandler('computer:processList', [], ctx.sender)) },
  { name: 'kill_process', run: async (A, ctx) => {
    if (!A.pid) return 'E:need pid'
    return String(await invokeHandler('computer:killProcess', [A.pid], ctx.sender))
  } },
  { name: 'save_memory', run: (A, ctx) => {
    const m = ctx.getMemory()
    const fact = String(A.fact || '').trim()
    if (!fact) return 'E:need fact'
    const scan = scanMemoryText(fact)
    if (!scan.ok) return 'E:' + scan.reason
    // 自省整改 #7: 约定/规则/偏好类事实自动置顶, 避免关键约定沉底丢失
    const autoPin = !A.pinned && /约定|规则|偏好|以后|必须|每次/.test(fact)
    // 同任务内存快照同步(dispatch 子代理与同任务召回可见)
    if (A.pinned || autoPin) {
      const pf = m.pinnedFacts || []
      if (pf.some(f => String(f).trim() === fact)) return 'ok:already saved'
      m.pinnedFacts = [...pf, fact]
    } else {
      if (m.facts.some(f => String(f).trim() === fact)) return 'ok:already saved'
      m.facts = [...m.facts, fact]
    }
    const agent = ctx.agent || '助手'
    const scope: 'global' | 'private' = ctx.agent && ctx.agents[ctx.agent] && ctx.agents[ctx.agent].memoryScope === 'private' ? 'private' : 'global'
    const id = upsertFactDb(agent, scope, fact, !!(A.pinned || autoPin), String(ctx.latestUserText || fact))
    if (id > 0) {
      void embedText(fact).then(vec => { if (vec && vec.length) setMemoryEmbedding(id, vec) }).catch(() => {})
    }
    ctx.saveMemory(m) // db 可用时 saveMemory 只同步快照(事实已落库), 不可用时走 JSON 降级
    return 'ok:saved' + (autoPin ? '（已自动置顶：约定/规则类）' : '')
  } },
  { name: 'recall_memory', run: async (A, ctx) => {
    const query = (A.query || '').trim()
    const agent = ctx.agent || '助手'
    const scope: 'global' | 'private' = ctx.agent && ctx.agents[ctx.agent] && ctx.agents[ctx.agent].memoryScope === 'private' ? 'private' : 'global'
    try {
      const fused = await recallMemoryDb(agent, scope, query, 5)
      if (fused) return formatFusedHits(fused)
    } catch { /* db 不可用时回退 JSON 关键词通道 */ }
    return recallFromMemory(ctx.getMemory(), query, [])
  } },
  { name: 'session_search', run: async (A, ctx) => {
    const q = String(A.query || '').trim()
    if (!q) return 'E:need query'
    // v0.4.0 M2: FTS5 后端(跨会话全文检索), 失败/未命中回退旧实现
    try {
      if (ctx.userDataPath) {
        const hits = searchSessions(join(ctx.userDataPath, 'sessions'), q, A.limit ? Number(A.limit) : 5)
        if (hits.length) {
          return hits.map((x, i) => `${i + 1}. [${x.sid}](${x.role}) ${new Date(x.ts).toLocaleDateString('zh-CN')} ${x.snippet.slice(0, 160)}`).join('\n---\n')
        }
      }
    } catch { /* 回退旧实现 */ }
    const r = await invokeHandler('sessions:search', [q, A.limit ? Number(A.limit) : 5], ctx.sender) as { title: string; role: string; snippet: string; ts: number }[]
    return Array.isArray(r) && r.length ? r.map((x, i) => `${i + 1}. [${x.title}](${x.role}) ${new Date(x.ts).toLocaleDateString('zh-CN')} ${x.snippet}`).join('\n---\n') : '(no matches)'
  } },
  { name: 'recall_events', run: (A, ctx) => {
    // v0.4.0 M3: 情景记忆时间线(从审计表按 Agent + 时间范围取回)
    const range = String(A.timeRange || 'week')
    const days = range === 'day' ? 1 : range === 'month' ? 30 : 7
    const from = Date.now() - days * 86400000
    const rows = queryAudit({ agent: ctx.agent || undefined, from, limit: 50 })
    if (!rows.length) return '(该时间段无操作记录)'
    return rows.map((r, i) => `${i + 1}. [${new Date(r.ts).toLocaleString('zh-CN')}] ${r.agent || '助手'} ${r.tool || ''} → ${r.resultSummary || r.argsSummary || ''}`.slice(0, 200)).join('\n')
  } },
  { name: 'recall_tool_output', run: (A, ctx) => {
    // v0.4.0 M7: side-channel 取回(每次会话最多 5 次, 返回截断 1.5KB)
    const id = Number(A.id)
    if (!id) return 'E:need id'
    const used = recallOutputCounts.get(ctx.sid) || 0
    if (used >= 5) return 'E:本次会话取回次数已达上限(5 次), 请基于已有摘要继续, 或改用原始工具重新获取'
    const content = getToolOutput(id)
    if (!content) return 'E:存档不存在或已过期: ' + id
    recallOutputCounts.set(ctx.sid, used + 1)
    return content.slice(0, 1500) + (content.length > 1500 ? '\n...[取回内容已截断]' : '')
  } },
  { name: 'codebox', run: async (A, ctx) => {
    if (!A.lang || !A.code) return 'E:need lang+code'
    return String(await invokeHandler('computer:codebox', [A.lang, A.code], ctx.sender))
  } },
  { name: 'import_doc', run: async (A, ctx) => {
    if (!A.path) return 'E:need path'
    const ok = await invokeHandler('memory:importFile', [A.path], ctx.sender)
    return ok === true ? 'ok:imported' : 'E:import failed'
  } },
  { name: 'schedule_task', run: async (A, ctx) => {
    if (!A.expression || !A.prompt) return 'E:need expression+prompt'
    const cr = await invokeHandler('cron:add', [A.expression, A.prompt], ctx.sender)
    return JSON.stringify(cr)
  } },
  { name: 'list_schedules', run: async (A, ctx) => {
    const items = await invokeHandler('cron:list', [], ctx.sender) as { enabled?: boolean; expression: string; prompt: string }[]
    return Array.isArray(items) && items.length ? items.map((j, i) => (i + 1) + '. [' + (j.enabled ? 'on' : 'off') + '] ' + j.expression + ' - ' + j.prompt).join(' | ') : '(empty)'
  } },
  { name: 'mcp_connect', run: async (A, _ctx) => {
    if (!A.name || !A.command) return 'E:need name+command'
    try {
      const { connectServer } = require('../mcp/client')
      const tools = await connectServer(A.name, A.command, A.args ? A.args.split(' ') : [])
      getMcpToolSpecs(true)
      return 'ok:' + A.name + ' (' + (Array.isArray(tools) ? tools.length : 0) + ' tools)'
    } catch (e: unknown) { return 'E:MCP 连接失败: ' + errMsg(e) }
  } },
  { name: 'mcp_call', run: async (A, _ctx) => {
    if (!A.server || !A.tool) return 'E:need server+tool'
    try {
      const { callMCPTool } = require('../mcp/client')
      const r = await callMCPTool(A.server, A.tool, (A.args || '{}') as unknown as Record<string, unknown>)
      return typeof r === 'string' ? r : JSON.stringify(r)
    } catch (e: unknown) { return 'E:' + errMsg(e) }
  } },
  { name: 'set_workdir', run: (A, ctx) => {
    if (!A.path) return 'E:need path'
    ctx.workDir = A.path
    ctx.onWorkDirChange?.(A.path)
    return '工作目录已设为(本次会话): ' + A.path
  } },
  { name: 'set_theme', run: (A, ctx) => {
    if (!A.theme) return 'E:need theme'
    ctx.onThemeChange?.(A.theme)
    return '主题已切换: ' + A.theme
  } },
  { name: 'get_ui_display', run: (A, ctx) => {
    try { return JSON.stringify(ctx.g.uiDisplay || {}, null, 2) } catch { return '{}' }
  } },
  { name: 'set_ui_display', run: (A, ctx) => {
    const raw = (A as unknown as { patches?: unknown }).patches
    let patches: Record<string, unknown> | undefined
    if (typeof raw === 'string') {
      try { patches = JSON.parse(raw) } catch { return 'E:patches JSON 解析失败' }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      patches = raw as Record<string, unknown>
    }
    if (!patches) return 'E:patches 必须是对象'
    const BOOLS = ['hideSessionSearch', 'hideSessionList', 'hidePlanCards', 'hideChatToolbar', 'hideAttachmentBar', 'hideModelPicker', 'hideThinkSelector', 'hideTokenUsage', 'hideTimestamps', 'hideToolCalls', 'hideTokenMeta', 'hideCopyButtons', 'hideRegenerate']
    const next: Record<string, unknown> = { ...(ctx.g.uiDisplay || {}) }
    const applied: string[] = []
    const errors: string[] = []
    for (const [k, v] of Object.entries(patches)) {
      if (k === 'hiddenNav') {
        if (Array.isArray(v) && v.every(x => typeof x === 'string')) { next[k] = v; applied.push(k) } else errors.push('hiddenNav 必须是字符串数组')
      } else if (k === 'density') {
        if (['compact', 'comfortable', 'spacious'].includes(String(v))) { next[k] = String(v); applied.push(k) } else errors.push('density 仅支持 compact/comfortable/spacious')
      } else if (k === 'customCss') {
        next[k] = String(v ?? '').slice(0, 65536); applied.push(k)
      } else if (k === 'statusLine') {
        next[k] = String(v ?? '').slice(0, 500); applied.push(k)
      } else if (BOOLS.includes(k)) {
        if (typeof v === 'boolean') { next[k] = v; applied.push(k) } else errors.push(k + ' 必须是布尔值')
      } else {
        errors.push('未知字段: ' + k)
      }
    }
    if (!applied.length) return 'E:' + (errors.join('; ') || '无可应用的字段')
    const merged = next as UiDisplayConfig
    ctx.g.uiDisplay = merged
    ctx.onUiDisplayChange?.(merged)
    return '界面已更新: ' + applied.map(k => k + '=' + JSON.stringify(next[k])).join(', ') + (errors.length ? '\n[已忽略无效项] ' + errors.join('; ') : '')
  } },
  { name: 'get_settings', run: (A, ctx) => {
    try {
      const raw = JSON.parse(fs.readFileSync(join(ctx.userDataPath, 'settings.json'), 'utf-8'))
      const red = redactSettings(raw) as { providers?: unknown; mediaProviders?: unknown; general?: unknown }
      const section = String(A.section || 'general')
      const pick = section === 'all' ? red
        : section === 'providers' ? { providers: red.providers || [] }
        : section === 'mediaProviders' ? { mediaProviders: red.mediaProviders || [] }
        : { general: red.general || {} }
      return JSON.stringify(pick, null, 2).slice(0, 24000)
    } catch (e: unknown) { return 'E:' + errMsg(e) }
  } },
  { name: 'set_settings', writeOp: true, run: (A, ctx) => {
    const section = String(A.section || 'general')
    const rawPatch = (A as unknown as { patch?: unknown }).patch
    let patch: unknown = rawPatch
    if (typeof rawPatch === 'string') {
      try { patch = JSON.parse(rawPatch) } catch { return 'E:patch JSON 解析失败' }
    }
    const settingsPath = join(ctx.userDataPath, 'settings.json')
    try {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: Record<string, unknown>; providers?: { id: string; [k: string]: unknown }[]; mediaProviders?: { id: string; [k: string]: unknown }[] }
      if (section === 'general') {
        const r = sanitizeGeneralPatch(patch)
        if (!r.ok) return 'E:设置补丁校验失败: ' + r.problems.join('; ')
        data.general = data.general || {}
        if (r.value.uiDisplay && typeof r.value.uiDisplay === 'object') {
          const merged = { ...((data.general.uiDisplay as object) || {}), ...(r.value.uiDisplay as object) }
          data.general.uiDisplay = merged
          ctx.g.uiDisplay = merged as UiDisplayConfig
          // 不触发 onUiDisplayChange: 主进程已落盘并广播 settings:changed, 渲染层统一 reload。
          // 否则 uiDisplay 事件会让渲染层用旧快照立即 save, 覆盖同一补丁里的其他字段(theme/workDir 等)。
          delete r.value.uiDisplay
        }
        Object.assign(data.general, r.value)
        Object.assign(ctx.g, r.value)
        if (typeof r.value.workDir === 'string' && r.value.workDir.trim()) {
          try { fs.mkdirSync(r.value.workDir.trim(), { recursive: true }) } catch { /* 目录创建失败不阻断设置保存 */ }
        }
      } else if (section === 'providers' || section === 'mediaProviders') {
        const r = sanitizeProvidersPatch(patch, section)
        if (!r.ok) return 'E:设置补丁校验失败: ' + r.problems.join('; ')
        const cur = (Array.isArray(data[section]) ? data[section] : []) as { id: string; [k: string]: unknown }[]
        for (const item of (r.value.list || []) as { id: string; [k: string]: unknown }[]) {
          let target = cur.find(x => x.id === item.id)
          if (!target) { target = { id: item.id }; cur.push(target) }
          for (const [k, v] of Object.entries(item)) if (k !== 'id') target[k] = v
        }
        data[section] = cur
      } else {
        return 'E:section 仅支持 general/providers/mediaProviders'
      }
      writeFileAtomicIfChanged(settingsPath, JSON.stringify(data, null, 2))
      try { ctx.sender?.send('settings:changed') } catch { /* 无窗口忽略 */ }
      return 'ok:设置已保存并即时生效(section=' + section + ')\n修改: ' + JSON.stringify(patch).slice(0, 1500)
    } catch (e: unknown) { return 'E:' + errMsg(e) }
  } },
  { name: 'handoff', run: (A, ctx) => {
    if (ctx.isSubtask) return 'E:子任务内不允许交接，请直接完成当前子任务或返回主控角色'
    if (!A.agent_name) return 'E:缺少角色名'
    const ag = ctx.agents[A.agent_name]
    if (!ag) return 'E:未知角色: ' + A.agent_name
    if ((ctx.g.disabledAgents || []).includes(A.agent_name)) return 'E:该角色已被禁用: ' + A.agent_name
    const handoffCounts = ctx.getHandoffCounts ? ctx.getHandoffCounts() : {}
    const handoffMelt = (ctx.g.meltdownLimit || 3) + 2
    if ((handoffCounts[A.agent_name] || 0) >= handoffMelt) {
      return 'E:该角色已被反复交接 ' + (handoffCounts[A.agent_name] || 0) + ' 次, 疑似死循环。请在当前角色直接完成剩余工作, 或改用 dispatch 并行分发'
    }
    const maxChain = ctx.g.maxHandoffChain || 3
    if (!ctx.activeAgents.includes(A.agent_name) && ctx.activeAgents.length >= maxChain) {
      ctx.g.maxHandoffChain = ctx.activeAgents.length + 1
      ctx.logTrace('warn', 'handoff.chain-extend', A.agent_name + ' 链长 ' + ctx.activeAgents.length + ' → ' + (ctx.activeAgents.length + 1))
    }
    ctx.onHandoffRecord?.(String(A.agent_name))
    ctx.onAgentChange(A.agent_name)
    return `已交接给 ${A.agent_name}(${ag.role})。原因: ${A.reason || '能力边界外'}。现在你以 ${A.agent_name} 的身份继续执行。\n\n【${A.agent_name} 身份】${ag.prompt}`
  } },
  { name: 'list_agents', run: (A, ctx) => {
    const disabled = ctx.g.disabledAgents || []
    return Object.entries(ctx.agents).filter(([n]) => !disabled.includes(n)).map(([n, ag]) => `${ag.icon} **${n}** (${ag.role}): ${ag.prompt.slice(0, 80)}... | 工具: ${ag.tools.join(', ')}`).join('\n\n')
  } },
  { name: 'dispatch', run: async (A, ctx) => {
    if (ctx.isSubtask) return 'E:子任务内不允许再次分发，请直接完成当前子任务'
    const raw = (A as unknown as Record<string, unknown>).tasks ?? (A as unknown as Record<string, unknown>).plan ?? '[]'
    const dTasks = parseDispatchTasks(raw)
    return await ctx.runDispatch(dTasks)
  } },
  { name: 'list_workflows', run: () => Object.entries(WORKFLOWS).map(([id, w]) => `- **${id}** (${w.name}): 触发词 → ${w.triggers.slice(0, 3).join(', ')}; ${w.steps.length} 步骤`).join('\n') },
  { name: 'run_workflow', run: (A) => {
    if (!A.workflow_id) return 'E:need workflow_id'
    const wf = WORKFLOWS[A.workflow_id]
    if (!wf) return 'E:unknown workflow: ' + A.workflow_id
    let vars: Record<string, string> = {}
    try { vars = JSON.parse(A.variables || '{}') } catch { vars = {} }
    const steps = wf.steps.map((s, i) => `${i + 1}. ${s.desc} → \`${s.tool}(${s.args_template.replace(/\{(\w+)\}/g, (_: string, k: string) => vars[k] || `{${k}}`)})\``).join('\n')
    return `工作流 **${wf.name}** (${wf.steps.length}步):\n${steps}\n\n请按顺序执行以上步骤，每步完成后验证结果。`
  } },
  { name: 'read_image', run: async (A, ctx) => {
    if (!A.path) return 'E:need path'
    return String(await invokeHandler('computer:readImageBase64', [A.path], ctx.sender))
  } },
  { name: 'media_img', run: async (A, ctx) => {
    if (!A.prompt) return 'E:need prompt'
    const r = await invokeHandler('media:gen', [{ kind: 'img', prompt: String(A.prompt), ratio: A.ratio ? String(A.ratio) : undefined }], ctx.sender) as { ok?: boolean; path?: string; error?: string }
    return r?.ok ? ('图片已生成: ' + (r.path || '')) : ('生成失败: ' + (r?.error || ''))
  } },
  { name: 'media_video', run: async (A, ctx) => {
    if (!A.prompt) return 'E:need prompt'
    const r = await invokeHandler('media:gen', [{ kind: 'video', prompt: String(A.prompt), duration: A.duration ? Number(A.duration) : undefined }], ctx.sender) as { ok?: boolean; path?: string; error?: string }
    return r?.ok ? ('视频已生成: ' + (r.path || '')) : ('生成失败: ' + (r?.error || ''))
  } },
  { name: 'show_card', run: (A) => {
    if (!A.html) return 'E:need html'
    return '<!--CARD' + (A.title ? ':' + A.title : '') + '-->' + A.html + '<!--/CARD-->'
  } },
  { name: 'bridge_notify', run: (A) => {
    try { new Notification({ title: A.title || 'Acheron-agent', body: A.body || '' }).show() } catch { /* 忽略 */ }
    return 'ok:notified'
  } },
  { name: 'workflow', run: (A, ctx) => {
    if (!A.script) return 'E:need script'
    if (String(A.script).length > 8192) return 'E:workflow script too long (max 8KB)'
    return new Promise<string>(resolve => {
      const logs: string[] = []
      let settled = false
      const timeout = setTimeout(() => finish('E:workflow timeout (30s)'), 30000)
      const finish = (r: unknown) => { if (settled) return; settled = true; clearTimeout(timeout); resolve(String(r)) }
      const wctx = {
        log: (msg: unknown) => { logs.push(String(msg)); if (logs.length > 200) logs.shift() },
        tools: { run: async (n: string, args: Record<string, unknown>) => {
          logs.push('[wf] ' + n)
          if (!runToolRef) return 'E:runTool 未初始化'
          return await runToolRef(n, args, ctx)
        } },
        done: (r: unknown) => finish(JSON.stringify({ result: r, logs }, null, 2)),
      }
      try {
        const fn = new Function('ctx', '"use strict"; ' + A.script)
        const ret = fn(wctx)
        if (ret instanceof Promise) {
          ret.then(v => finish(JSON.stringify({ result: v, logs }, null, 2))).catch(e => finish('E:workflow error: ' + errMsg(e)))
        } else if (!settled) finish(JSON.stringify({ result: ret ?? null, logs }, null, 2))
      } catch (e) { finish('E:workflow error: ' + errMsg(e)) }
    })
  } },
  { name: 'audit_log', run: (A, ctx) => {
    const mem = ctx.getMemory()
    const log = (mem.episodic || []).slice(-(Number(A.limit || 20)))
    return log.length ? log.map((e, i) => `${i + 1}. [${new Date(e.ts).toLocaleString('zh-CN')}] ${e.op} ${e.path || ''} → ${e.status}`).join('\n') : '(无操作记录)'
  } },
  { name: 'watch_file', run: async (A, ctx) => {
    if (!A.path) return 'E:need path'
    try {
      const content = String(await invokeHandler('computer:readFile', [A.path], ctx.sender))
      let hash = ''
      try {
        const crypto = require('crypto')
        hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 32)
      } catch { hash = content.length + ':' + content.slice(0, 200) }
      if (watchState[A.path] && watchState[A.path] !== hash) {
        const old = watchState[A.path]
        watchState[A.path] = hash
        return `CHANGED: ${A.path} (hash: ${old.slice(0, 16)}... → ${hash.slice(0, 16)}...)`
      }
      watchState[A.path] = hash
      return `WATCHING: ${A.path} (${content.length} bytes). Call again to detect changes.`
    } catch (e: unknown) { return 'E:watch failed: ' + errMsg(e) }
  } },
  { name: 'save_goal', run: (A, ctx) => {
    const mem = ctx.getMemory()
    const goals = mem.goals || []
    goals.push({ goal: A.goal, steps: A.steps ? JSON.parse(A.steps) : [], created: Date.now(), status: 'active' })
    mem.goals = goals
    ctx.saveMemory(mem)
    if (ctx.onGoalUpdate) ctx.onGoalUpdate(String(A.goal || '').slice(0, 500))
    return 'ok:goal_saved (' + goals.length + ' goals total)'
  } },
  { name: 'list_goals', run: (A, ctx) => {
    const goals = ctx.getMemory().goals || []
    return goals.length ? goals.map((g, i) => `${i + 1}. [${g.status}] ${g.goal} (${(g.steps || []).length} steps, ${new Date(g.created || 0).toLocaleDateString('zh-CN')})`).join('\n') : '(无持久化目标)'
  } },
  { name: 'install_plugin', writeOp: true, run: async (A, ctx) => {
    const name = String(A.name || '').trim()
    const description = String(A.description || '').trim()
    const code = String(A.code || '')
    if (!name || !description || !code) return 'E:need name+description+code'
    const v = validatePluginCode(name, description, code)
    if (!v.ok) return 'E:插件校验失败:\n- ' + v.problems.join('\n- ')
    const rawSettings = (A as unknown as { settings?: unknown }).settings
    let settings: unknown = rawSettings
    if (typeof rawSettings === 'string') {
      try { settings = JSON.parse(rawSettings) } catch { return 'E:settings JSON 解析失败' }
    }
    const sv = validatePluginSettings(settings)
    if (!sv.ok) return 'E:插件设置 schema 校验失败:\n- ' + sv.problems.join('\n- ')
    const toolNames = v.tools.map(t => 'plugin_' + name + '__' + t.name).join(', ')
    const d = await requestRiskConfirm({
      kind: '插件安装',
      detail: `插件「${name}」将新增 ${v.tools.length} 个工具(运行在沙箱内: 文件仅限工作目录, 命令受危险拦截)。\n\n${v.tools.map(t => '- ' + t.name + ': ' + t.description.slice(0, 120)).join('\n')}`,
      level: 'L3',
      sid: ctx.sid,
      taskId: ctx.taskId,
    })
    if (d !== 'allow') return 'E:permission denied: ' + (d === 'timeout' ? '确认超时(60 秒未操作, 已自动拒绝)' : '用户拒绝了插件安装')
    const r = installPlugin(join(ctx.userDataPath, 'plugins'), name, description, code, String(A.overwrite) === 'true', sv.defs)
    if (!r.ok) return 'E:' + (r.error || '安装失败')
    invalidatePluginToolSpecCache()
    try { ctx.sender?.send('plugins:changed') } catch { /* 无窗口忽略 */ }
    return `ok:插件已安装 v${r.version} 并热加载(无需重启), 新工具下一轮即可调用:\n${toolNames}\n提示: 首次调用每个插件工具会弹出权限确认, 可选择「始终允许」。`
  } },
  { name: 'list_plugins', run: (A, ctx) => {
    const list = listPluginDetails(join(ctx.userDataPath, 'plugins'))
    if (!list.length) return '(未安装任何插件; 可用 install_plugin 给自己写一个)'
    const disabled = (n: string) => isPluginDisabled(join(ctx.userDataPath, 'settings.json'), n) ? ' [已禁用]' : ''
    return list.map(p => `- **${p.name}** v${p.version}${p.selfWritten ? ' [自写]' : ''}${p.hasImpl ? '' : ' [缺实现]'}${disabled(p.name)}: ${p.description}\n  工具: ${p.tools.length ? p.tools.map(t => 'plugin_' + p.name + '__' + t).join(', ') : '(无)'}`).join('\n')
  } },
  { name: 'read_plugin', run: (A, ctx) => readPluginSource(join(ctx.userDataPath, 'plugins'), String(A.name || '').trim()) },
  { name: 'remove_plugin', writeOp: true, run: async (A, ctx) => {
    const name = String(A.name || '').trim()
    if (!name) return 'E:need name'
    const d = await requestRiskConfirm({ kind: '删除插件', detail: '删除插件: ' + name, level: 'L3', sid: ctx.sid, taskId: ctx.taskId })
    if (d !== 'allow') return 'E:permission denied: ' + (d === 'timeout' ? '确认超时(60 秒未操作, 已自动拒绝)' : '用户拒绝了删除')
    const r = removePlugin(join(ctx.userDataPath, 'plugins'), name)
    if (!r.ok) return 'E:' + (r.error || '删除失败')
    invalidatePluginToolSpecCache()
    try { ctx.sender?.send('plugins:changed') } catch { /* 无窗口忽略 */ }
    return 'ok:已删除插件 ' + name
  } },
  { name: 'reload_plugins', run: (A, ctx) => {
    bustAllPluginCaches(join(ctx.userDataPath, 'plugins'))
    invalidatePluginToolSpecCache()
    const list = listPluginDetails(join(ctx.userDataPath, 'plugins'))
    return 'ok:已重新扫描插件目录, 当前 ' + list.length + ' 个插件(工具列表下一轮生效)'
  } },
]
