# 黄泉Agent 版本验证：启动应用 -> CDP 检查 -> 截图 -> 关闭
# 用法: powershell -ExecutionPolicy Bypass -File scripts/launch-verify.ps1 -VersionDir D:\...\v0.3.2\源码 -Port 9232
param(
  [Parameter(Mandatory=$true)][string]$VersionDir,
  [Parameter(Mandatory=$true)][int]$Port,
  [switch]$About
)

$exe = Join-Path $VersionDir 'node_modules\electron\dist\electron.exe'
$tmpUd = Join-Path $env:TEMP ("hq-v" + $Port)
if (Test-Path -LiteralPath $tmpUd) { Remove-Item -LiteralPath $tmpUd -Recurse -Force }

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $exe
$psi.Arguments = '. --user-data-dir="' + $tmpUd + '" --remote-debugging-port=' + $Port
$psi.WorkingDirectory = $VersionDir
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$proc = [System.Diagnostics.Process]::Start($psi)

Start-Sleep -Seconds 10
$alive = -not $proc.HasExited
Write-Output ("ALIVE={0}" -f $alive)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$outDir = 'C:\Users\ROG\.codex\visualizations\2026\08\04\019fcd60-e9a7-72e3-8aec-46c31810326e'
$extra = ''
if ($About) { $extra = 'about' }
node (Join-Path $scriptDir 'verify-cdp.cjs') $Port $outDir $extra

if (-not $alive) {
  Write-Output ("EXIT={0}" -f $proc.ExitCode)
  try {
    ($proc.StandardError.ReadToEnd()) -split "`n" | Select-String 'FATAL|ERROR' | Select-Object -First 4 | ForEach-Object { Write-Output $_.Line }
  } catch {}
}

Get-Process -ProcessName electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Output 'DONE'
