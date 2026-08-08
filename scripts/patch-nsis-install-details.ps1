$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'node_modules\app-builder-lib\templates\nsis\installSection.nsh'
if (-not (Test-Path $target)) { throw "找不到 installSection.nsh: $target" }
$s = [System.IO.File]::ReadAllText($target)

# 1) 详情打印: none -> both(安装时显示每个文件的解压细节)
if ($s -match '(?m)^\s*SetDetailsPrint none\s*$') {
  $s = [regex]::Replace($s, '(?m)^\s*SetDetailsPrint none\s*$', '  SetDetailsPrint both')
}

# 2) 注入中文阶段提示(幂等: 已存在则跳过)
$marks = [ordered]@{
  '!insertmacro installApplicationFiles' = 'DetailPrint "正在解压应用文件…"'
  '!insertmacro registryAddInstallInfo'  = 'DetailPrint "正在写入安装信息…"'
  '!insertmacro addStartMenuLink'        = 'DetailPrint "正在创建开始菜单快捷方式…"'
  '!insertmacro addDesktopLink'          = 'DetailPrint "正在创建桌面快捷方式…"'
}
foreach ($anchor in $marks.Keys) {
  $line = $marks[$anchor]
  if ($s -notmatch [regex]::Escape($line)) {
    $s = $s -replace [regex]::Escape($anchor), ($line + "`n" + $anchor)
  }
}
if ($s -notmatch 'SetDetailsPrint both') { throw '补丁状态异常: SetDetailsPrint both 未生效' }
[System.IO.File]::WriteAllText($target, $s, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'OK: NSIS 安装详情已打补丁(SetDetailsPrint both + 阶段提示)'
