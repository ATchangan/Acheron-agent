# 黄泉Agent 版本验证：启动应用 -> CDP 检查 -> 截图 -> 关闭
# 用法: powershell -ExecutionPolicy Bypass -File scripts/launch-verify.ps1 -VersionDir D:\...\v0.3.2\源码 -Port 9232
param(
  [Parameter(Mandatory=$true)][string]$VersionDir,
  [Parameter(Mandatory=$true)][int]$Port,
  [switch]$About,
  [switch]$Strategy,
  [switch]$Features,
  [switch]$Chat,
  [string]$UserData = ''
)

$exe = Join-Path $VersionDir 'node_modules\electron\dist\electron.exe'
$tmpUd = $UserData
if (-not $tmpUd) {
  $tmpUd = Join-Path $env:TEMP ("hq-v" + $Port)
  if (Test-Path -LiteralPath $tmpUd) { Remove-Item -LiteralPath $tmpUd -Recurse -Force }
}
$oldUserData = $env:HQ_USER_DATA
$env:HQ_USER_DATA = $tmpUd

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
$outDir = Join-Path $env:TEMP 'hq-verify-artifacts'
$extra = ''
if ($About) { $extra = 'about' }
if ($Strategy) { $extra = 'strategy' }
if ($Features) { $extra = 'features' }
if ($Chat) {
  node (Join-Path $scriptDir 'verify-chat.cjs') $Port '你好，用一句话介绍自己' '读取 D:\桌面\黄泉agent\打包发布流程.md 的第一行并原样回复'
} else {
  node (Join-Path $scriptDir 'verify-cdp.cjs') $Port $outDir $extra
}

Get-Process -ProcessName electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
if ($Chat) {
  try {
    ($proc.StandardError.ReadToEnd()) -split "`n" | Select-String 'FAIL|ERROR|error|Error' | Select-Object -Last 12 | ForEach-Object { Write-Output ("STDERR: " + $_.Line) }
  } catch {}
}
if (-not $alive) {
  Write-Output ("EXIT={0}" -f $proc.ExitCode)
  try {
    ($proc.StandardError.ReadToEnd()) -split "`n" | Select-String 'FATAL|ERROR' | Select-Object -First 4 | ForEach-Object { Write-Output $_.Line }
  } catch {}
}

Write-Output 'DONE'
$env:HQ_USER_DATA = $oldUserData
