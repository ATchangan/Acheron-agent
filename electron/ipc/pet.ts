// electron/ipc/pet.ts — 桌宠 IPC 桥(v0.4.0 M9)
import { ipcMain, Menu } from 'electron'
import type { PetManager } from '../pet'

export function registerPetIpc(deps: { pet: PetManager }): void {
  const { pet } = deps

  ipcMain.handle('pet:toggle', (_e, enable?: boolean) => pet.toggle(enable === undefined ? undefined : Boolean(enable)))
  ipcMain.handle('pet:state', () => pet.isEnabled())
  ipcMain.handle('pet:set-form', (_e, form: string) => pet.setForm(form === 'ultimate' ? 'ultimate' : 'normal'))
  ipcMain.handle('pet:set-action', (_e, action: string) => pet.setAction(action === 'dance1' || action === 'dance2' || action === 'dance3' ? action : 'idle'))
  ipcMain.handle('pet:open-main', () => { pet.openMain(); return true })
  ipcMain.handle('pet:moved', (_e, x: number, y: number) => { pet.move(Number(x) || 0, Number(y) || 0); return true })
  ipcMain.handle('pet:reset-pos', () => { pet.resetPosition(); return true })
  ipcMain.handle('pet:menu', () => {
    const form = pet.getForm()
    const action = pet.getAction()
    const actionItems = ([
      ['idle', '待机'], ['dance1', '极乐净土'], ['dance2', '彩虹节拍'], ['dance3', 'Good Time'],
    ] as const).map(([value, label]) => ({
      label,
      type: 'radio' as const,
      checked: action === value,
      click: () => pet.setAction(value),
    }))
    const menu = Menu.buildFromTemplate([
      {
        label: form === 'ultimate' ? '形态：大招（切回正常）' : '形态：正常（切换大招）',
        click: () => pet.toggleForm(),
      },
      { label: '动作', submenu: actionItems },
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
