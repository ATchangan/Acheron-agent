# 同步 Hermes/Codex 吸收改动到版本发布快照(通用文件部分)
# 用法: powershell -ExecutionPolicy Bypass -File scripts/sync-hermes.ps1
$dev = 'D:\桌面\黄泉agent\黄泉agent开发版'
$rel = 'D:\桌面\黄泉agent\版本发布'

# 对所有 5 个版本通用(结构一致)
$common = @(
  'electron\ipc\sessions.ts',
  'electron\ipc\misc.ts',
  'electron\preload.ts',
  'src\global.d.ts',
  'src\components\settings\AboutTab.tsx',
  'src\store\project-ctx.ts'
)
# 0.3.2~0.3.5 通用(0.3.1 需单独适配)
$v32plus = @(
  'src\store\tools.ts',
  'src\store\chat-send.ts'
)

foreach ($v in 'v0.3.1','v0.3.2','v0.3.3','v0.3.4','v0.3.5') {
  foreach ($f in $common) {
    Copy-Item -LiteralPath (Join-Path $dev $f) -Destination (Join-Path "$rel\$v\源码" $f) -Force
  }
  Write-Output ("{0}: common synced" -f $v)
}
foreach ($v in 'v0.3.2','v0.3.3','v0.3.4','v0.3.5') {
  foreach ($f in $v32plus) {
    Copy-Item -LiteralPath (Join-Path $dev $f) -Destination (Join-Path "$rel\$v\源码" $f) -Force
  }
  Write-Output ("{0}: v32plus synced" -f $v)
}
# 0.3.3/0.3.4: memory/runtime 与 0.3.2 同源(已打 Hermes 补丁)
foreach ($v in 'v0.3.3','v0.3.4') {
  foreach ($f in 'src\store\memory.ts','src\store\runtime.ts') {
    Copy-Item -LiteralPath (Join-Path "$rel\v0.3.2\源码" $f) -Destination (Join-Path "$rel\$v\源码" $f) -Force
  }
  Write-Output ("{0}: memory/runtime synced from 0.3.2" -f $v)
}
# 0.3.5: memory/context/runtime 与开发版一致
foreach ($f in 'src\store\memory.ts','src\store\context.ts','src\store\runtime.ts') {
  Copy-Item -LiteralPath (Join-Path $dev $f) -Destination (Join-Path "$rel\v0.3.5\源码" $f) -Force
}
Write-Output 'v0.3.5: dev trio synced'
# Hermes 单测: 全版本
foreach ($v in 'v0.3.1','v0.3.2','v0.3.3','v0.3.4','v0.3.5') {
  Copy-Item -LiteralPath (Join-Path $dev 'src\store\hermes.test.ts') -Destination (Join-Path "$rel\$v\源码" 'src\store\hermes.test.ts') -Force
}
Write-Output 'hermes tests synced'
Write-Output 'SYNC_DONE'
