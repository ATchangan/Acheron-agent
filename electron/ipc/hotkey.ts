// electron/ipc/hotkey.ts —— 系统级"随叫随到"零摩擦入口(v0.4.3)
// 全局热键: 任意应用内选中文本按热键 → 唤起主窗口 + 读取剪贴板选中 → 填入聊天输入框(选中即问)。
import { ipcMain, globalShortcut, clipboard } from 'electron'
import type { BrowserWindow } from 'electron'

let lastHotkey = ''

export function registerGlobalHotkey(getWindow: () => BrowserWindow | null, accelerator: string): boolean {
  if (lastHotkey) {
    try { globalShortcut.unregister(lastHotkey) } catch { /* 忽略 */ }
    lastHotkey = ''
  }
  const acc = String(accelerator || '').trim()
  if (!acc) return false
  try {
    const ok = globalShortcut.register(acc, () => {
      const w = getWindow()
      if (!w) return
      w.show()
      w.focus()
      const text = clipboard.readText()
      w.webContents.send('hotkey:ask', text || '')
    })
    if (ok) lastHotkey = acc
    return ok
  } catch { return false }
}

export function unregisterGlobalHotkey(): void {
  if (lastHotkey) {
    try { globalShortcut.unregister(lastHotkey) } catch { /* 忽略 */ }
    lastHotkey = ''
  }
}

export function getRegisteredHotkey(): string {
  return lastHotkey
}

export function registerHotkeyIpc(deps: { getWindow: () => BrowserWindow | null }): void {
  const { getWindow } = deps
  ipcMain.handle('hotkey:set', (_e, acc: string) => registerGlobalHotkey(getWindow, String(acc || '')))
  ipcMain.handle('hotkey:get', () => getRegisteredHotkey())
  ipcMain.handle('hotkey:unregister', () => { unregisterGlobalHotkey(); return true })
}
