// electron/shared/pwsh.ts —— PowerShell 可执行文件检测(全引擎共用)
// 优先级: PowerShell 7(pwsh) > Windows PowerShell > cmd(仅 exec_command 的纯 ASCII 简单命令)
// pwsh 必须真实可启动才算可用 —— 只存在于 PATH 但损坏/不支持的安装视为未安装
import { execSync } from 'child_process'

let pwshAvailable: boolean | null = null

export function getPowerShellCmd(): string {
  if (pwshAvailable === null) {
    try {
      execSync('pwsh -NoProfile -NonInteractive -Command "exit 0"', { windowsHide: true, stdio: 'pipe', timeout: 8000 })
      pwshAvailable = true
    } catch { pwshAvailable = false }
  }
  return pwshAvailable ? 'pwsh' : 'powershell'
}
