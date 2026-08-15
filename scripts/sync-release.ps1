# 同步开发版吸收改动到发布版快照（v0.3.2 当前版）
# 用法: powershell -ExecutionPolicy Bypass -File scripts/sync-release.ps1
$dev = 'D:\桌面\助手agent\助手agent开发版'
$rel = 'D:\桌面\助手agent\版本发布'

# v0.3.2 为当前版本，直接与开发版对齐；v0.3.1 为基线快照，不做同步
$target = "$rel\v0.3.2\源码"

# 通用吸收文件
$common = @(
  'electron\ipc\sessions.ts',
  'electron\ipc\misc.ts',
  'electron\preload.ts',
  'src\global.d.ts',
  'src\components\settings\AboutTab.tsx',
  'src\store\project-ctx.ts'
)
# 0.3.2+ 通用
$v32plus = @(
  'src\store\tools.ts',
  'src\store\chat-send.ts'
)
# 与开发版一致的核心三件套
$devTrio = @(
  'src\store\memory.ts',
  'src\store\context.ts',
  'src\store\runtime.ts'
)

foreach ($f in ($common + $v32plus + $devTrio)) {
  Copy-Item -LiteralPath (Join-Path $dev $f) -Destination (Join-Path $target $f) -Force
}
Write-Output 'v0.3.2: synced from dev'
Write-Output 'SYNC_DONE'
