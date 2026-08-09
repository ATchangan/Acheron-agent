// electron/ipc/diagnostics.ts —— 一键环境自检(覆盖用户使用可能遇到的所有问题)
// 只读检查: PowerShell/工作目录/供应商/网络/磁盘/技能/插件/浏览器内核/日志/Git/本地服务等
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import * as os from 'os'
import { execFile } from 'child_process'
import { getPowerShellCmd } from '../shared/pwsh'

export interface DiagItem {
  name: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
  fix?: string
}

export interface DiagDeps {
  settingsPath: string
  userDataPath: string
  getWorkDir: () => string
  netFetch: typeof fetch
  getServerPort: () => number
}

function probe(exe: string, args: string[]): Promise<boolean> {
  return new Promise(resolve => {
    execFile(exe, args, { windowsHide: true, timeout: 4000 }, e => resolve(!e))
  })
}

async function checkPowerShell7(): Promise<DiagItem> {
  const cmd = getPowerShellCmd()
  if (cmd === 'pwsh') return { name: 'PowerShell 7', status: 'ok', detail: 'pwsh 可用，已优先使用' }
  return { name: 'PowerShell 7', status: 'warn', detail: '未检测到可用的 PowerShell 7，已回退 Windows PowerShell', fix: '安装 PowerShell 7 可获得现代语法与 UTF-8 输出：winget install Microsoft.PowerShell' }
}

async function checkWindowsPowerShell(): Promise<DiagItem> {
  const ok = await probe('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'])
  return ok
    ? { name: 'Windows PowerShell', status: 'ok', detail: 'powershell.exe 可用（PS7 缺失时的回退项）' }
    : { name: 'Windows PowerShell', status: 'fail', detail: 'powershell.exe 无法启动', fix: '系统 PowerShell 缺失，命令执行将不可用，请修复系统组件' }
}

async function checkCmd(): Promise<DiagItem> {
  const p = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe')
  return fs.existsSync(p)
    ? { name: 'cmd', status: 'ok', detail: 'cmd.exe 可用（纯 ASCII 简单命令走 cmd）' }
    : { name: 'cmd', status: 'warn', detail: 'cmd.exe 不存在', fix: '系统组件缺失，请检查 Windows 完整性' }
}

function checkWorkDir(getWorkDir: () => string): DiagItem {
  const workDir = getWorkDir()
  try {
    if (!workDir) return { name: '工作目录', status: 'warn', detail: '未设置工作目录', fix: '在 设置→引擎 中设置工作目录' }
    if (!fs.existsSync(workDir)) return { name: '工作目录', status: 'fail', detail: '目录不存在：' + workDir, fix: '在 设置→引擎 中重新选择存在的目录' }
    if (!fs.statSync(workDir).isDirectory()) return { name: '工作目录', status: 'fail', detail: '不是目录：' + workDir, fix: '在 设置→引擎 中重新选择目录' }
    fs.accessSync(workDir, fs.constants.W_OK)
    return { name: '工作目录', status: 'ok', detail: workDir }
  } catch {
    return { name: '工作目录', status: 'fail', detail: '目录不可写：' + workDir, fix: '检查目录权限或换一个可写目录' }
  }
}

function checkWritable(name: string, dir: string, fix: string): DiagItem {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    return { name, status: 'ok', detail: dir }
  } catch {
    return { name, status: 'fail', detail: '不可写：' + dir, fix }
  }
}

function checkProviders(settingsPath: string): DiagItem {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { providers?: { id?: string; name?: string; apiKey?: string; baseUrl?: string; models?: string[] }[] }
    const list = Array.isArray(s.providers) ? s.providers : []
    const valid = list.filter(p => p.apiKey && p.baseUrl)
    if (!list.length) return { name: 'API 供应商', status: 'fail', detail: '未配置任何供应商', fix: '在 设置→模型服务 中添加供应商并填入 API Key' }
    if (!valid.length) return { name: 'API 供应商', status: 'fail', detail: '共 ' + list.length + ' 个供应商，但都没有完整的 API Key/地址', fix: '在 设置→模型服务 中补全密钥与地址' }
    return { name: 'API 供应商', status: 'ok', detail: valid.length + '/' + list.length + ' 个供应商配置完整' }
  } catch {
    return { name: 'API 供应商', status: 'fail', detail: '设置文件读取失败', fix: '设置文件损坏，可在 设置→引擎→数据管理 恢复出厂或备份恢复' }
  }
}

async function checkProviderNetwork(deps: DiagDeps): Promise<DiagItem> {
  try {
    const s = JSON.parse(fs.readFileSync(deps.settingsPath, 'utf-8')) as { providers?: { baseUrl?: string }[] }
    const base = (Array.isArray(s.providers) ? s.providers : []).find(p => p.baseUrl)?.baseUrl
    if (!base) return { name: '供应商网络', status: 'warn', detail: '未配置供应商地址，跳过网络检测' }
    const res = await deps.netFetch(base, { method: 'GET', signal: AbortSignal.timeout(6000) })
    return { name: '供应商网络', status: 'ok', detail: base + ' 可达（HTTP ' + res.status + '）' }
  } catch (e) {
    return { name: '供应商网络', status: 'fail', detail: '无法连接：' + String(e instanceof Error ? e.message : e).slice(0, 120), fix: '检查网络/代理，或确认供应商地址与防火墙设置' }
  }
}

function checkDisk(userDataPath: string): DiagItem {
  try {
    const st = fs.statfsSync(userDataPath)
    const free = Number(st.bavail) * Number(st.bsize)
    const gb = free / 1024 / 1024 / 1024
    if (gb < 0.5) return { name: '磁盘空间', status: 'fail', detail: '可用空间仅 ' + gb.toFixed(2) + ' GB', fix: '清理磁盘空间，否则会话/记忆可能无法保存' }
    if (gb < 2) return { name: '磁盘空间', status: 'warn', detail: '可用空间 ' + gb.toFixed(2) + ' GB（偏低）', fix: '建议保留 2GB 以上可用空间' }
    return { name: '磁盘空间', status: 'ok', detail: '可用 ' + gb.toFixed(1) + ' GB' }
  } catch {
    return { name: '磁盘空间', status: 'warn', detail: '无法读取磁盘空间' }
  }
}

function checkMemory(): DiagItem {
  const free = os.freemem() / 1024 / 1024 / 1024
  return free < 2
    ? { name: '内存', status: 'warn', detail: '空闲内存仅 ' + free.toFixed(1) + ' GB', fix: '关闭部分程序后再运行长任务' }
    : { name: '内存', status: 'ok', detail: '空闲内存 ' + free.toFixed(1) + ' GB' }
}

function checkSkills(userDataPath: string): DiagItem {
  const dir = join(userDataPath, 'skills')
  try {
    const hasSkill = fs.existsSync(dir) && fs.readdirSync(dir).some(e => fs.existsSync(join(dir, e, 'SKILL.md')))
    return hasSkill
      ? { name: '技能', status: 'ok', detail: '技能目录可用，已发现技能' }
      : { name: '技能', status: 'warn', detail: '技能目录为空', fix: '可在 设置→技能 中安装技能包' }
  } catch {
    return { name: '技能', status: 'warn', detail: '技能目录不可读', fix: '检查用户数据目录权限' }
  }
}

function checkPlugins(userDataPath: string): DiagItem {
  const dir = join(userDataPath, 'plugins')
  try {
    const has = fs.existsSync(dir) && fs.readdirSync(dir).length > 0
    return has ? { name: '插件', status: 'ok', detail: '插件目录可用，已发现 ' + fs.readdirSync(dir).length + ' 项' } : { name: '插件', status: 'warn', detail: '插件目录为空', fix: '可在 设置→插件 中安装插件' }
  } catch {
    return { name: '插件', status: 'warn', detail: '插件目录不可读', fix: '检查用户数据目录权限' }
  }
}

function checkBrowserKernel(): DiagItem {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
  const hit = candidates.find(p => fs.existsSync(p))
  return hit
    ? { name: '浏览器内核', status: 'ok', detail: hit }
    : { name: '浏览器内核', status: 'warn', detail: '未找到 Edge/Chrome', fix: '浏览器工具（网页解析/实时画面）需要 Microsoft Edge 或 Google Chrome' }
}

function checkRendererMode(settingsPath: string): DiagItem {
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: { rendererMode?: string } }
    const mode = s.general?.rendererMode || 'auto'
    return mode === 'cpu'
      ? { name: '渲染模式', status: 'warn', detail: '当前为 CPU 兼容模式，性能较低', fix: '可在 设置→外观 切回「自动」或「GPU」' }
      : { name: '渲染模式', status: 'ok', detail: mode }
  } catch {
    return { name: '渲染模式', status: 'ok', detail: 'auto' }
  }
}

function checkGit(): Promise<DiagItem> {
  return probe('git', ['--version']).then(ok =>
    ok
      ? { name: 'Git', status: 'ok', detail: 'git 可用（git 工具正常）' }
      : { name: 'Git', status: 'warn', detail: '未安装或未加入 PATH', fix: '安装 Git for Windows：winget install Git.Git' },
  )
}

async function checkMcp(): Promise<DiagItem> {
  try {
    const n = (require('../mcp/client').listServers() as unknown[]).length
    return n > 0
      ? { name: 'MCP 服务器', status: 'ok', detail: '已连接 ' + n + ' 个服务器' }
      : { name: 'MCP 服务器', status: 'warn', detail: '未连接任何服务器', fix: '可在 设置→MCP 中添加服务器' }
  } catch {
    return { name: 'MCP 服务器', status: 'ok', detail: '模块未启用' }
  }
}

async function checkLocalServer(deps: DiagDeps): Promise<DiagItem> {
  try {
    const port = deps.getServerPort()
    const res = await deps.netFetch('http://127.0.0.1:' + port + '/index.html', { signal: AbortSignal.timeout(3000) })
    return res.ok ? { name: '本地服务', status: 'ok', detail: '端口 ' + port + ' 正常' } : { name: '本地服务', status: 'warn', detail: '本地服务返回异常状态 ' + res.status }
  } catch {
    return { name: '本地服务', status: 'fail', detail: '本地服务不可用', fix: '重启应用；若持续异常请查看 运行轨迹 中的错误' }
  }
}

export async function runEnvironmentCheck(deps: DiagDeps): Promise<DiagItem[]> {
  const items: DiagItem[] = []
  items.push(await checkPowerShell7())
  items.push(await checkWindowsPowerShell())
  items.push(await checkCmd())
  items.push(checkWorkDir(deps.getWorkDir))
  items.push(checkWritable('用户数据目录', deps.userDataPath, '检查用户目录权限或更换安装位置'))
  items.push(checkWritable('会话目录', join(deps.userDataPath, 'sessions'), '检查用户数据目录权限'))
  items.push(checkWritable('回滚目录', join(deps.userDataPath, 'rollback'), '检查用户数据目录权限'))
  items.push(checkProviders(deps.settingsPath))
  items.push(await checkProviderNetwork(deps))
  items.push(checkDisk(deps.userDataPath))
  items.push(checkMemory())
  items.push(checkSkills(deps.userDataPath))
  items.push(checkPlugins(deps.userDataPath))
  items.push(checkBrowserKernel())
  items.push(checkRendererMode(deps.settingsPath))
  items.push(await checkGit())
  items.push(await checkMcp())
  items.push(await checkLocalServer(deps))
  items.push({ name: '运行环境', status: 'ok', detail: 'Node ' + process.versions.node + ' / Electron ' + process.versions.electron })
  return items
}

export function registerDiagnosticsIpc(deps: DiagDeps): void {
  ipcMain.handle('diagnostics:check', () => runEnvironmentCheck(deps))
}
