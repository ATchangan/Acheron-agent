import { describe, expect, it } from 'vitest'
import { quotePowerShellExe, resolvePowerShell } from './pwsh'

describe('PowerShell 检测场景覆盖(其它用户安装方式)', () => {
  it('PATH 中有可用 pwsh(winget/MSI/商店) → 优先使用 pwsh', () => {
    const r = resolvePowerShell(() => true, ['C:\\PF\\pwsh.exe'], () => true)
    expect(r).toEqual({ exe: 'pwsh', isPwsh: true })
  })

  it('PATH 无 pwsh, 但已知安装路径存在且可启动(绿色版/非 PATH) → 用完整路径', () => {
    const p = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
    const r = resolvePowerShell(exe => exe === p, [p], () => true)
    expect(r).toEqual({ exe: p, isPwsh: true })
  })

  it('已知路径存在但启动不了(损坏) → 回退 Windows PowerShell', () => {
    const r = resolvePowerShell(() => false, ['C:\\Program Files\\PowerShell\\7\\pwsh.exe'], () => true)
    expect(r).toEqual({ exe: 'powershell', isPwsh: false })
  })

  it('已知路径不存在 → 不探测, 回退 Windows PowerShell', () => {
    const r = resolvePowerShell(exe => exe !== 'pwsh', ['C:\\no\\pwsh.exe'], () => false)
    expect(r).toEqual({ exe: 'powershell', isPwsh: false })
  })

  it('quotePowerShellExe: 含空格路径加引号, 纯命令名不加', () => {
    expect(quotePowerShellExe('pwsh')).toBe('pwsh')
    expect(quotePowerShellExe('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('"C:\\Program Files\\PowerShell\\7\\pwsh.exe"')
  })
})
