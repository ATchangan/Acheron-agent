// electron/ipc/pet.ts — 桌宠 IPC 桥(v0.4.0 M9)
import { ipcMain, Menu, screen } from 'electron'
import type { PetManager, PetSettings } from '../pet'

export function registerPetIpc(deps: { pet: PetManager }): void {
  const { pet } = deps
  let dragTimer: ReturnType<typeof setInterval> | null = null
  let dragSeq = 0

  ipcMain.handle('pet:toggle', (_e, enable?: boolean) => pet.toggle(enable === undefined ? undefined : Boolean(enable)))
  ipcMain.handle('pet:state', () => pet.isEnabled())
  ipcMain.handle('pet:set-form', (_e, form: string) => pet.setForm(form === 'ultimate' ? 'ultimate' : 'normal'))
  ipcMain.handle('pet:set-action', (_e, action: string) => pet.setAction(action === 'dance1' || action === 'dance2' || action === 'dance3' ? action : 'idle'))
  ipcMain.handle('pet:set-anchor', (_e, anchor: string) => pet.setAnchor(anchor === 'window' || anchor === 'taskbar' ? anchor : 'float'))
  ipcMain.handle('pet:set-options', (_e, patch: Record<string, unknown>) => {
    const p: Partial<PetSettings> = {}
    for (const k of ['scale', 'opacity', 'chibi']) {
      const v = Number((patch || {})[k])
      if (Number.isFinite(v)) (p as Record<string, unknown>)[k] = v
    }
    for (const k of ['topmost', 'look', 'physics', 'bubble']) {
      const v = (patch || {})[k]
      if (v === true || v === false) (p as Record<string, unknown>)[k] = v
    }
    const breath = (patch || {}).breath
    if (breath === 'light' || breath === 'normal' || breath === 'strong') p.breath = breath
    const gesture = (patch || {}).gesture
    if (gesture === 'low' || gesture === 'normal' || gesture === 'high') p.gesture = gesture
    pet.applyOptions(p)
    return true
  })
  ipcMain.handle('pet:shape', (_e, rect: { x: number; y: number; width: number; height: number }) => { pet.applyShape(rect || null); return true })
  ipcMain.handle('pet:open-main', () => { pet.openMain(); return true })
  ipcMain.handle('pet:focus', () => { pet.focusInput(); return true })
  ipcMain.handle('pet:unfocus', () => { pet.unfocusInput(); return true })
  ipcMain.handle('pet:chat', (_e, content: string) => { pet.relayChat(String(content || '').slice(0, 2000)); return true })
  ipcMain.handle('pet:moved', (_e, x: number, y: number) => { pet.move(Number(x) || 0, Number(y) || 0); return true })
  ipcMain.handle('pet:reset-pos', () => { pet.resetPosition(); return true })
  // 拖动: 主进程 16ms 轮询光标并实时跟随窗口, 鼠标移出窗口也能继续拖(窗口追着光标跑)
  ipcMain.handle('pet:drag-start', (_e, p: { mx: number; my: number }) => {
    const win = pet.getWindow()
    if (!win || dragTimer) return false
    pet.dragStart()
    const seq = ++dragSeq
    const sx = Number(p?.mx) || 0
    const sy = Number(p?.my) || 0
    const [wx, wy] = win.getPosition()
    const [ww, wh] = win.getSize()
    dragTimer = setInterval(() => {
      try {
        const c = screen.getCursorScreenPoint()
        // 透明无边框窗口在 150% DPI 下 setPosition 会 +1px, 拖动必须用带显式尺寸的 setBounds
        win.setBounds({ x: wx + c.x - sx, y: wy + c.y - sy, width: ww, height: wh }, false)
      } catch { /* 忽略 */ }
    }, 16)
    // 保险: 12s 强制结束, 防止 mouseup 在快速拖动中丢失导致拖拽僵住
    setTimeout(() => {
      if (dragSeq === seq && dragTimer) { clearInterval(dragTimer); dragTimer = null }
    }, 12000)
    return true
  })
  ipcMain.handle('pet:drag-end', () => {
    dragSeq += 1
    if (dragTimer) { clearInterval(dragTimer); dragTimer = null }
    pet.dragEnd()
    return true
  })
  ipcMain.handle('pet:menu', () => {
    const form = pet.getForm()
    const action = pet.getAction()
    const anchor = pet.getAnchor()
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
        label: '位置',
        submenu: ([
          ['float', '自由漂浮'], ['window', '坐视窗（跟随活动窗口）'], ['taskbar', '坐任务栏'],
        ] as const).map(([value, label]) => ({
          label,
          type: 'radio' as const,
          checked: anchor === value,
          click: () => pet.setAnchor(value),
        })),
      },
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
