// electron/win32-windows.ts — 常驻 PowerShell 窗口探针(v0.4.0)
// 桌宠「坐视窗/坐任务栏」需要枚举可见顶层窗口与任务栏矩形。
// 不引入原生模块(项目 npm install 受脚本保护), 改为 spawn 一个常驻 powershell.exe,
// 通过 stdin 收 'poll' 指令、stdout 回一行 JSON, 主进程每 ~380ms 拉一次。
import { spawn, type ChildProcess } from 'child_process'

export interface WinRect { l: number; t: number; r: number; b: number }
export interface WinEntry { h: number; t: string; c: string; l: number; tp: number; r: number; b: number }
export interface WinSnapshot { fg: number; tray: WinRect | null; wins: WinEntry[] }

const EMPTY: WinSnapshot = { fg: 0, tray: null, wins: [] }

const PS_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HQWinProbe {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
}
'@
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput())
$out.AutoFlush = $true
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line -eq 'exit') { break }
  if ($line -ne 'poll') { continue }
  $fg = [HQWinProbe]::GetForegroundWindow()
  $rows = New-Object System.Collections.ArrayList
  $cb = [HQWinProbe+EnumProc]{
    param($h, $l)
    $r = New-Object HQWinProbe+RECT
    if ([HQWinProbe]::IsWindowVisible($h) -and -not [HQWinProbe]::IsIconic($h) -and [HQWinProbe]::GetWindowRect($h, [ref]$r)) {
      $cloaked = 0
      [void][HQWinProbe]::DwmGetWindowAttribute($h, 14, [ref]$cloaked, 4)
      if ($cloaked -eq 0) {
        $w = $r.Right - $r.Left
        $ht = $r.Bottom - $r.Top
        if ($w -ge 120 -and $ht -ge 80) {
          $t = New-Object System.Text.StringBuilder 256
          [void][HQWinProbe]::GetWindowText($h, $t, 256)
          $c = New-Object System.Text.StringBuilder 256
          [void][HQWinProbe]::GetClassName($h, $c, 256)
          $cls = $c.ToString()
          if ($cls -ne 'Progman' -and $cls -ne 'WorkerW' -and $cls -ne 'Shell_TrayWnd' -and $cls -ne 'Shell_SecondaryTrayWnd') {
            [void]$rows.Add(@{ h = $h.ToInt64(); t = $t.ToString(); c = $cls; l = $r.Left; tp = $r.Top; r = $r.Right; b = $r.Bottom })
          }
        }
      }
    }
    return $true
  }
  [void][HQWinProbe]::EnumWindows($cb, [IntPtr]::Zero)
  $tray = $null
  $trayH = [HQWinProbe]::FindWindow('Shell_TrayWnd', $null)
  if ($trayH -ne [IntPtr]::Zero) {
    $tr = New-Object HQWinProbe+RECT
    if ([HQWinProbe]::GetWindowRect($trayH, [ref]$tr)) { $tray = @{ l = $tr.Left; t = $tr.Top; r = $tr.Right; b = $tr.Bottom } }
  }
  $o = @{ fg = $fg.ToInt64(); tray = $tray; wins = @($rows) }
  $json = ConvertTo-Json -InputObject $o -Compress -Depth 4
  $out.WriteLine($json)
}
`

export class WinProbe {
  private proc: ChildProcess | null = null
  private buf = ''
  private waiters: Array<(s: WinSnapshot) => void> = []
  private latest: WinSnapshot = EMPTY
  private stopping = false

  start(): void {
    if (process.platform !== 'win32') return
    if (this.proc) return
    const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64')
    this.proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    )
    if (process.env.HQ_PET_DEBUG === '1') console.debug('[win-probe] started pid=', this.proc.pid)
    this.proc.stdout?.setEncoding('utf8')
    this.proc.stdout?.on('data', (chunk: string) => this.onData(chunk))
    this.proc.once('exit', () => {
      if (process.env.HQ_PET_DEBUG === '1') console.debug('[win-probe] exited, stopping=', this.stopping)
      if (!this.stopping) {
        this.proc = null
        // 探针异常退出: 15s 后自动重启
        setTimeout(() => { if (!this.stopping) this.start() }, 15000)
      } else {
        this.proc = null
      }
      this.rejectAll()
    })
    this.proc.once('error', () => { /* 启动失败: 探针留空, 坐视窗模式回退为不移动 */ })
  }

  private onData(chunk: string): void {
    this.buf += chunk
    let idx: number
    while ((idx = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim()
      this.buf = this.buf.slice(idx + 1)
      if (!line) continue
      try {
        const snap = JSON.parse(line) as WinSnapshot
        this.latest = snap
        const w = this.waiters.shift()
        if (w) w(snap)
      } catch { /* 半行或非 JSON 输出, 忽略 */ }
    }
  }

  poll(): Promise<WinSnapshot> {
    if (process.platform !== 'win32') return Promise.resolve(EMPTY)
    if (!this.proc) this.start()
    return new Promise(resolve => {
      this.waiters.push(resolve)
      try { this.proc?.stdin?.write('poll\n') } catch { /* 忽略 */ }
      // 探针无响应兜底: 4s 后返回最近一次快照
      const w = this.waiters
      setTimeout(() => {
        const i = w.indexOf(resolve)
        if (i >= 0) {
          if (process.env.HQ_PET_DEBUG === '1') console.debug('[win-probe] poll timeout, latest=', JSON.stringify(this.latest))
          w.splice(i, 1); resolve(this.latest)
        }
      }, 4000)
    })
  }

  getLatest(): WinSnapshot { return this.latest }

  private rejectAll(): void {
    const ws = this.waiters
    this.waiters = []
    for (const w of ws) w(this.latest)
  }

  stop(): void {
    this.stopping = true
    try { this.proc?.stdin?.write('exit\n') } catch { /* 忽略 */ }
    try { this.proc?.kill() } catch { /* 忽略 */ }
    this.proc = null
    this.rejectAll()
  }
}
