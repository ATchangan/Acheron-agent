// electron/ipc/computer.ts —— 电脑控制域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, shell, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import * as os from 'os'
import { exec, type ChildProcess } from 'child_process'
import { requestRiskConfirm, type RiskDecision } from './risk-confirm'
import { registerComputerFiles } from './computer-files'
import { getPowerShellCmdQuoted } from '../shared/pwsh'
const iconv = require('iconv-lite') as { decode: (b: Buffer, enc: string) => string }


export function registerComputerIpc(deps: {
  assertInsideWorkDir: (p: string) => boolean
  assessRisk: (e: { type: string; command?: string; operation?: string; path?: string }) => string
  getEffectiveWorkDir: () => string | undefined
  getWorkDirOverride: () => string | null
  setWorkDirOverride: (d: string | null) => void
  netFetch: typeof fetch
  workspaceDir: string
  userDataPath: string
}): void {
  const { assertInsideWorkDir, assessRisk, getEffectiveWorkDir, setWorkDirOverride, workspaceDir, userDataPath } = deps
  // 运行中的命令注册表(sid → 子进程), 供引擎停止时立即打断超长命令
  const runningExecs = new Map<string, { proc: ChildProcess; timer: ReturnType<typeof setTimeout> }>()
  // Windows 上 exec 只拿到外层 cmd.exe, kill 不会终止 powershell 子进程树 → 用 taskkill /T /F
  const killTree = (pid: number | undefined) => {
    if (!pid) return
    try { exec('taskkill /pid ' + pid + ' /T /F', { windowsHide: true, timeout: 5000 }, () => {}) } catch { /* 忽略 */ }
    try { process.kill(pid) } catch { /* 忽略 */ }
  }
  // 按 sid 标记杀整棵树(外层 pid 可能已脱管, 用命令行标记兜底)
  const killBySid = (sid: string) => {
    const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*HQ_SID=*" + sid + "*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    try { exec(getPowerShellCmdQuoted() + ' -NoProfile -NonInteractive -Command "' + ps.replace(/"/g, '\\"') + '"', { timeout: 8000, windowsHide: true }, () => {}) } catch { /* 忽略 */ }
  }
  // 按根 PID 递归杀全部后代(cmd 外层可能提前退出, 孙进程仍挂在已死 PID 下)
  const killTreeByRoot = (rootPid: number | undefined) => {
    if (!rootPid) return
    const ps = "$root=" + rootPid + "; $all=Get-CimInstance Win32_Process; $kids=@{}; foreach($p in $all){ if($p.ParentProcessId){ if(-not $kids.ContainsKey([int]$p.ParentProcessId)){ $kids[[int]$p.ParentProcessId]=@() }; $kids[[int]$p.ParentProcessId]+=[int]$p.ProcessId } }; $st=New-Object System.Collections.Generic.Stack[int]; $st.Push($root); while($st.Count -gt 0){ $cur=$st.Pop(); if($kids.ContainsKey($cur)){ foreach($k in $kids[$cur]){ Stop-Process -Id $k -Force -ErrorAction SilentlyContinue; $st.Push($k) } }; Stop-Process -Id $cur -Force -ErrorAction SilentlyContinue }"
    try { exec(getPowerShellCmdQuoted() + ' -NoProfile -NonInteractive -Command "' + ps.replace(/"/g, '\\"') + '"', { timeout: 8000, windowsHide: true }, () => {}) } catch { /* 忽略 */ }
  }

  // 风险操作确认 —— L2(终端写/非只读命令)与 L3(系统路径写入/删除)默认弹原生确认框;
  // 设置 riskConfirm=false 时静默放行(保持旧行为)。
  // v0.3.3 修复: L2 只对"会改变系统状态"的命令确认(node -v/npm ls/git status 等只读查询不再打扰)。
  const isMutating = (cmd: string): boolean => {
    const c = String(cmd || '')
    return /(\bdel\b|\brm\b|\bremove\b|delete|erase|move|ren\b|copy|mkdir|mci\b|install|uninstall|publish|\bpush\b|\bcommit\b|\bmerge\b|\breset\b|drop\b|truncate|update|insert|\bkill\b|taskkill|stop-|restart-|set-|new-|remove-|clear-|format|mount|unmount|shutdown|reboot|chmod|chown|attrib|takeown|icacls|reg\s+(add|delete)|npm\s+(install|uninstall)|pip\s+(install|uninstall)|git\s+(push|commit|merge|reset|clean|checkout\s+-)|docker\s+(rm|stop|kill|build|push)|Start-Process|Invoke-WebRequest|>|>>)/i.test(c)
  }
  // v0.3.3: 确认不再弹原生 Windows 窗口 —— 推送到软件内角落卡片,
  // 60 秒无人操作自动拒绝; 可勾选「本次任务都批准」
  const confirmRisk = async (
    level: string | undefined,
    kind: string,
    detail: string,
    sid?: string,
    taskId?: string,
  ): Promise<RiskDecision> => {
    if (level !== 'L2' && level !== 'L3') return 'allow'
    if (level === 'L2' && !isMutating(detail)) return 'allow'
    try {
      const s = JSON.parse(fs.readFileSync(join(userDataPath, 'settings.json'), 'utf-8'))
      // v0.3.6: 「永久放行全部风险操作」开关 —— 开启后 L2/L3 全部直接放行
      if (s?.general?.riskAutoApprove === true) return 'allow'
      if (s?.general?.riskConfirm === false) return 'allow'
      // v0.3.4: 「以后都批准」—— 该操作类型已持久化放行, 直接跳过确认
      if (Array.isArray(s?.general?.riskAlwaysAllow) && s.general.riskAlwaysAllow.includes(kind)) return 'allow'
    } catch { /* 设置缺失时默认确认 */ }
    return requestRiskConfirm({ kind, detail, level, sid, taskId })

  }

  registerComputerFiles({ assertInsideWorkDir, assessRisk, confirmRisk, getEffectiveWorkDir, userDataPath })

ipcMain.handle('computer:exec', async (_e, cmd: string, sid?: string, taskId?: string) => {
  const cmdS = String(cmd || '')
  const riskLevel = assessRisk({ type: 'terminal', command: cmdS })
  if (riskLevel === 'L4') {
    // v0.3.8: 危险命令归一化 —— 统一小写/反斜杠/连续空白后匹配, 防大小写与转义绕过
    const norm = cmdS.toLowerCase().replace(/\\+/g, '/').replace(/\s+/g, ' ').trim()
    const hit = ['rm -rf', 'rm -fr', 'format /', 'format c:', 'mkfs', 'dd if=', 'shutdown', 'restart', 'reg delete', 'chmod 777', 'curl | bash', 'wget | sh', '> /dev/sda', 'taskkill /f /im', 'taskkill /im', 'del /f /s /q c:', 'del /s /q c:', 'rd /s /q c:', 'rmdir /s /q c:', 'diskpart', 'bcdedit', 'format c'].find(d => norm.includes(d))
    return 'E:permission denied: 危险命令已被拦截 (' + (hit || '').trim() + ')。如需执行请手动在终端操作。'
  }
  const cr = await confirmRisk(riskLevel, '执行命令', cmdS, sid, taskId)
  if (cr !== 'allow') {
    return 'E:permission denied: ' + (cr === 'timeout' ? '确认超时（60 秒未操作，已自动拒绝）' : '用户拒绝了风险操作确认')
  }
  return new Promise<string>((resolve) => {
    const key = sid || ('m' + Date.now() + '_' + Math.random().toString(36).slice(2, 6))
    let settled = false
    const finish = (out: string) => { if (settled) return; settled = true; runningExecs.delete(key); resolve(out) }
    // 更可靠的 PowerShell 检测——检查 powershell 关键字和常见 cmdlet 模式
    const trimmed = cmd.trim()
    const isPS = /^(powershell|pwsh)\b/i.test(trimmed) ||
      /\b(Get-|Set-|New-|Invoke-|Write-|Select-|Where-|ForEach-|Start-Process)\b/i.test(trimmed) ||
      /\$(?:env:|[a-zA-Z_]\w*)/.test(trimmed) ||
      // v0.3.7: 含非 ASCII(中文路径/中文输出)的命令一律走 PowerShell —— cmd 在部分系统(OEM 437)会把中文输出成 '?'
      /[^\x00-\x7F]/.test(cmd)
    // v0.3.3: sid 标记写入环境变量赋值(命令行为可见), 中止时按标记杀整个进程树
    const marker = sid ? (isPS ? "$env:HQ_SID='" + sid + "'; " : 'set HQ_SID=' + sid + '&& ') : ''
    let finalCmd
    if (isPS) {
      finalCmd = `${getPowerShellCmdQuoted()} -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${marker}${cmd.replace(/"/g, '\\"')}"`
    } else {
      finalCmd = `cmd /c "${marker}${cmd.replace(/"/g, '\\"')}"`
    }
    // maxBuffer 从 10MB → 50MB; v0.3.0: cwd 跟随自定义工作目录(设置→引擎→工作目录)
    // v0.3.8: cmd 输出为本地代码页(中文系统 GBK), 直接 utf8 读会乱码 —— 去掉 encoding 拿 Buffer, cmd 分支按需 GBK 解码
    const child = exec(finalCmd, { timeout: 300000, maxBuffer: 50 * 1024 * 1024, cwd: getEffectiveWorkDir() }, (err, stdout, stderr) => {
      clearTimeout(timer)
      const raw = err ? (stderr || Buffer.from(err.message)) : (stdout || Buffer.from(''))
      const text = Buffer.isBuffer(raw)
        ? (isPS ? raw.toString('utf-8') : (() => { const u = raw.toString('utf-8'); return u.includes('\uFFFD') ? iconv.decode(raw, 'gbk') : u })())
        : String(raw)
      const out = text
      const truncated = out.length > 8000 ? out.slice(0, 8000) + '\n...(已截断，共' + out.length + '字符)' : out
      finish(truncated)
    })
    const timer = setTimeout(() => { killTree(child.pid); killTreeByRoot(child.pid); if (sid) killBySid(sid) }, 300000)
    runningExecs.set(key, { proc: child, timer })
  })
})
// v0.3.3: 中止运行中的命令 —— 引擎 stop 时调用, 超长 exec 立即打断
ipcMain.handle('computer:abort', (_e, sid?: string) => {
  if (!sid) {
    for (const [, r] of runningExecs) { clearTimeout(r.timer); killTree(r.proc.pid) }
    runningExecs.clear()
    return true
  }
  const rec = runningExecs.get(sid)
  if (rec) {
    clearTimeout(rec.timer)
    killTree(rec.proc.pid)
    killTreeByRoot(rec.proc.pid)
    runningExecs.delete(sid)
  }
  killBySid(sid)
  return true
})

// 实时性能采样 —— CPU(os.cpus 两次采样差) + RAM + GPU(Windows 性能计数器), 2s 缓存
let perfCache: { cpuPct: number; memPct: number; memUsed: number; memTotal: number; gpuPct: number; gpuName: string; cpus: number } | null = null; let perfCacheAt = 0
let lastCpuSample: { idle: number; total: number } | null = null; let lastCpuAt = 0
// GPU 采样 —— 优先 nvidia-smi(正在使用的 NVIDIA GPU, 准确), 失败回退性能计数器各引擎最大值
let gpuViaNvidia = true
function sampleGpu(): Promise<{ pct: number | null; name: string | null }> {
  return new Promise((resolve) => {
    if (gpuViaNvidia) {
      exec('nvidia-smi --query-gpu=name,utilization.gpu --format=csv,noheader,nounits', { timeout: 3000, windowsHide: true }, (err, stdout) => {
        if (err) { gpuViaNvidia = false; sampleGpuWin(resolve); return }
        const line = String(stdout).trim().split('\n')[0] || ''
        const m = line.match(/(.+),\s*(\d+)/)
        if (m) resolve({ pct: Math.max(0, Math.min(100, parseInt(m[2]))), name: m[1].trim() })
        else resolve({ pct: null, name: null })
      })
    } else sampleGpuWin(resolve)
  })
}
function sampleGpuWin(resolve: (v: { pct: number | null; name: string | null }) => void) {
  const script = "try { $s = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop).CounterSamples; if ($s -and $s.Count -gt 0) { ($s | Measure-Object -Property CookedValue -Maximum).Maximum } else { -1 } } catch { -1 }"
  exec(getPowerShellCmdQuoted() + ' -NoProfile -NonInteractive -Command "' + script.replace(/"/g, '\"') + '"', { timeout: 4000, windowsHide: true }, (err, stdout) => {
    if (err) return resolve({ pct: null, name: null })
    const v = parseFloat(String(stdout).trim().split('\n').pop() || '')
    resolve({ pct: isFinite(v) && v >= 0 ? Math.min(100, Math.round(v)) : null, name: null })
  })
}
ipcMain.handle('computer:sysPerf', async () => {
  const now = Date.now()
  if (perfCache && now - perfCacheAt < 2000) return perfCache
  // CPU 占用: 两次 os.cpus() 采样差
  const cpus = os.cpus()
  let idle = 0, total = 0
  for (const c of cpus) {
    idle += c.times.idle
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq
  }
  let cpuPct = 0
  if (lastCpuSample && now - lastCpuAt > 300) {
    const dIdle = idle - lastCpuSample.idle
    const dTotal = total - lastCpuSample.total
    cpuPct = dTotal > 0 ? Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100))) : 0
  }
  lastCpuSample = { idle, total }; lastCpuAt = now
  const memTotal = os.totalmem(), memFree = os.freemem()
  const memUsed = memTotal - memFree
  const memPct = Math.round(memUsed / memTotal * 100)
  const gpu = await sampleGpu()
  perfCache = { cpuPct, memPct, memUsed, memTotal, gpuPct: gpu.pct ?? 0, gpuName: gpu.name ?? '', cpus: cpus.length }
  perfCacheAt = now
  return perfCache
})
ipcMain.handle('computer:setWorkDir', (_e, dir: string) => { setWorkDirOverride(dir || null); return true })
ipcMain.handle('computer:contextMenu', (_e, opts: { path: string; isDir: boolean; isWorkDir?: boolean }) => {
  return new Promise<string>((resolve) => {
    try {
      const { Menu, clipboard } = require('electron')
      const { path, isDir, isWorkDir } = opts
      let done = false
      const pick = (a: string) => { if (!done) { done = true; resolve(a) } }
      const template: Electron.MenuItemConstructorOptions[] = [
        { label: isDir ? '打开文件夹' : '打开文件', click: () => pick('open') },
        { label: '复制路径', click: () => { clipboard.writeText('"' + path + '"'); pick('copy') } },
        { type: 'separator' },
        { label: '重命名', click: () => pick('rename') },
        { label: '删除', click: () => pick('delete') },
      ]
      if (isWorkDir) {
        template.push({ type: 'separator' })
        template.push({ label: '新建文件夹', click: () => pick('mkdir') })
        template.push({ label: '新建文件', click: () => pick('createFile') })
      }
      template.push({ type: 'separator' })
      template.push({ label: '刷新', click: () => pick('refresh') })
      const menu = Menu.buildFromTemplate(template)
      menu.on('menu-will-close', () => setTimeout(() => pick('none'), 200))
      menu.popup({ window: BrowserWindow.getFocusedWindow() || undefined })
    } catch { resolve('none') }
  })
})
ipcMain.handle('computer:systemInfo', () => ({
  platform: os.platform(), arch: os.arch(), hostname: os.hostname(),
  cpus: os.cpus().length, totalMemory: os.totalmem(), freeMemory: os.freemem(),
  uptime: os.uptime(), homeDir: os.homedir(), workspaceDir,
}))
ipcMain.handle('computer:openFile', async (_e, filePath: string) => { await shell.openPath(filePath); return true })
ipcMain.handle('computer:selectFile', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('computer:selectDir', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
// v0.3.0 图片调度修复 FIX-A: 纯文件读取为 dataURL(不解码, 归一化压缩在渲染层 utils/image.ts)
ipcMain.handle('computer:clipboardRead', () => { try{return require('electron').clipboard.readText()}catch{return''} })
ipcMain.handle('computer:clipboardWrite', (_e,text:string) => { try{require('electron').clipboard.writeText(text);return true}catch{return false} })

// ─── 代码沙箱 ───────────────────────────────────
ipcMain.handle('computer:codebox', async (_e, lang:string, code:string) => {
  return new Promise<string>(resolve => {
    const tmpDir = join(userDataPath, 'codebox')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const ext = lang === 'python' ? '.py' : lang === 'node' ? '.js' : '.txt'
    // 随机后缀防并发冲突; 顺带清理 60s 前残留的临时文件
    const fp = join(tmpDir, 'codebox_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + ext)
    try { for (const f of fs.readdirSync(tmpDir)) { if (f.startsWith('codebox_') && Date.now() - fs.statSync(join(tmpDir, f)).mtimeMs > 60000) { try { fs.unlinkSync(join(tmpDir, f)) } catch (e) { console.debug('[swallow]', e) } } } } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
    fs.writeFileSync(fp, code, 'utf-8')
    const cmd = lang === 'python' ? `python "${fp}"` : lang === 'node' ? `node "${fp}"` : `echo "unsupported: ${lang}"`
    exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf-8', env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }, (err, stdout, stderr) => {
      resolve(err ? (stderr || err.message) : stdout)
      try { fs.unlinkSync(fp) } catch (e) { console.debug('[swallow]', e) }
    })
  })
})
ipcMain.handle('computer:processList', async () => {
  return new Promise<string>(resolve=>{ exec('tasklist /FO CSV /NH',{timeout:5000},(e,o)=>resolve(o||'')) })
})
ipcMain.handle('computer:killProcess', async (_e,pid:string) => {
  return new Promise<string>(resolve=>{ exec(`taskkill /PID ${pid} /F`,{timeout:5000},(e,o)=>resolve(o||e?.message||'')) })
})

// v0.3.1 C3: abort 双语义 —— 参数为 requestId 时中止该请求; 为 sid 时中止该会话全部请求; 空则全部

}
