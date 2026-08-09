// electron/shared/pwsh.ts —— PowerShell 可执行文件检测(全引擎共用)
// PowerShell 7(pwsh)优先 —— 支持 && 与现代语法, 重定向输出默认 UTF-8; 不存在时回退 Windows PowerShell
import { execSync } from 'child_process'

let pwshAvailable: boolean | null = null

export function getPowerShellCmd(): string {
  if (pwshAvailable === null) {
    try {
      pwshAvailable = execSync('where.exe pwsh', { windowsHide: true, stdio: 'pipe' }).toString().trim().length > 0
    } catch { pwshAvailable = false }
  }
  return pwshAvailable ? 'pwsh' : 'powershell'
}
