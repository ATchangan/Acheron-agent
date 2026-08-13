// electron/ipc/pet.ts — 桌宠 IPC 桥(v0.4.0 M9)
import { ipcMain, Menu } from 'electron'
import type { PetManager } from '../pet'

export function registerPetIpc(deps: { pet: PetManager }): void {
  const { pet } = deps

  ipcMain.handle('pet:toggle', (_e, enable?: boolean) => pet.toggle(enable === undefined ? undefined : Boolean(enable)))
  ipcMain.handle('pet:state', () => pet.isEnabled())
  ipcMain.handle('pet:open-main', () => { pet.openMain(); return true })
  ipcMain.handle('pet:moved', (_e, x: number, y: number) => { pet.move(Number(x) || 0, Number(y) || 0); return true })
  ipcMain.handle('pet:reset-pos', () => { pet.resetPosition(); return true })
  ipcMain.handle('pet:menu', () => {
    const menu = Menu.buildFromTemplate([
      { label: '隐藏气泡', click: () => { pet.send('config', { bubble: false }) } },
      { label: '重置位置', click: () => pet.resetPosition() },
      { label: '打开设置', click: () => pet.openMain() },
      { type: 'separator' },
      { label: '隐藏桌宠', click: () => pet.toggle(false) },
    ])
    menu.popup()
    return true
  })
}
