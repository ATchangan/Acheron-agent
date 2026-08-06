// electron/ipc/browser.ts —— 浏览器域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, BrowserWindow, shell } from 'electron'

export function registerBrowserIpc(deps: {
  getBrowserWin: (key?: string) => BrowserWindow
  getBrowserWinIfExists: (key?: string) => BrowserWindow | null
  closeBrowserSession: (key: string) => void
  waitLoad: (wc: Electron.WebContents) => Promise<void>
  getCurUrl: () => string
  setCurUrl: (u: string) => void
  showBrowserPanel: () => void
  showBrowserFloat: () => void
  hideBrowserFloat: () => void
}): void {
  const { getBrowserWin, getBrowserWinIfExists, closeBrowserSession, waitLoad, getCurUrl, setCurUrl, showBrowserPanel, showBrowserFloat, hideBrowserFloat } = deps

  // 最近被 agent 使用的任务会话 —— 浏览器面板实时画面跟随它
  let activeBrowserKey = ''
  const winFor = (key?: string): BrowserWindow => {
    if (key) {
      activeBrowserKey = key
      return getBrowserWin(key)
    }
    return getBrowserWin()
  }
  const activeOrSharedWin = (): BrowserWindow => {
    if (activeBrowserKey) {
      const w = getBrowserWinIfExists(activeBrowserKey)
      if (w) return w
      activeBrowserKey = ''
    }
    return getBrowserWin()
  }

  // 仅允许 http/https, 阻止 file:// / javascript: 等危险协议
  const isSafeBrowserUrl = (u: string): boolean => {
    try {
      const p = new URL(u)
      return p.protocol === 'http:' || p.protocol === 'https:'
    } catch { return false }
  }

  // 与快照/点击共用的可交互元素收集逻辑(注入页面执行)
  const INTERACTIVE_JS = `
    const els = [...document.querySelectorAll('a, button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [tabindex]')]
    const out = []
    const seen = new Set()
    for (const el of els) {
      if (seen.has(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none') continue
      seen.add(el)
      out.push(el)
    }
  `

  ipcMain.handle('browser:showPanel', () => { showBrowserPanel(); hideBrowserFloat(); return true })
  // 窗口诊断
  ipcMain.handle('browser:debug', () => {
    const out: Record<string, unknown> = {}
    const bwAll = BrowserWindow.getAllWindows()
    out.all = bwAll.map((w: BrowserWindow) => {
      const p = w.getParentWindow()
      return { id: w.id, title: w.getTitle(), visible: w.isVisible(), bounds: w.getBounds(), parent: p ? p.id : null, alwaysOnTop: w.isAlwaysOnTop() }
    })
    return out
  })
  ipcMain.handle('browser:showFloat', () => { showBrowserFloat(); return true })
  ipcMain.handle('browser:hideFloat', () => { hideBrowserFloat(); return true })

  ipcMain.handle('browser:navigate', async (_e, url: string) => {
    if (!isSafeBrowserUrl(url)) return 'E:仅支持 http/https 网址'
    const bw = getBrowserWin(); const wc = bw.webContents
    try {
      if (wc.getURL() === url) return 'ok'
      ;(wc as unknown as { __loadStart: number }).__loadStart = Date.now()
      await wc.loadURL(url)
    } catch (e) { /* 继续 */ console.debug('[swallow]', e) }
    setCurUrl(wc.getURL() || url)
    return 'ok'
  })
  ipcMain.handle('browser:back', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    if (wc.canGoBack()) wc.goBack()
    setCurUrl(wc.getURL() || getCurUrl())
    return getCurUrl()
  })
  ipcMain.handle('browser:forward', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    if (wc.canGoForward()) wc.goForward()
    setCurUrl(wc.getURL() || getCurUrl())
    return getCurUrl()
  })
  ipcMain.handle('browser:reload', async () => {
    const bw = getBrowserWin(); const wc = bw.webContents
    wc.reload()
    return wc.getURL() || getCurUrl()
  })
  ipcMain.handle('browser:current', () => {
    const bw = getBrowserWin()
    if (bw && !bw.isDestroyed()) setCurUrl(bw.webContents.getURL() || getCurUrl())
    return getCurUrl()
  })
  // 实时快照 —— 前端轮询此接口显示 agent 正在看的页面
  // Windows 上隐藏窗口 capturePage 返回空 —— 截图时临时显示窗口再隐藏
  ipcMain.handle('browser:snapshot', async () => {
    let bw: BrowserWindow | null = null
    try {
      bw = activeOrSharedWin(); const wc = bw.webContents
      if (!wc || wc.isDestroyed()) return { url: getCurUrl(), img: '', loading: false }
      const curUrl = wc.getURL() || getCurUrl()
      if (wc.isLoading() && Date.now() - (wc as unknown as { __loadStart: number }).__loadStart < 15000) return { url: curUrl, img: '', loading: true }
      if (wc.isLoading()) return { url: curUrl, img: '', loading: false }
      const wasVisible = bw.isVisible()
      if (!wasVisible) { bw.showInactive(); await new Promise(r => setTimeout(r, 120)) }
      const img = await wc.capturePage()
      if (!wasVisible) bw.hide()
      let title = ''
      try { title = await wc.executeJavaScript('document.title') } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      return { url: curUrl, img: img.toDataURL(), loading: false, title: title || '' }
    } catch { if (bw && !bw.isDestroyed()) bw.hide(); return { url: getCurUrl(), img: '', loading: false, title: '' } }
  })
  // 可访问性快照 —— 返回标题/正文 + 带 @编号 的可交互元素(供 browser_click/type 使用)
  ipcMain.handle('browser:snapshotA11y', async (_e, url?: string, taskKey?: string) => {
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    if (url && isSafeBrowserUrl(url)) {
      try { await wc.loadURL(url) } catch (e) { /* 继续 */ console.debug('[swallow]', e) }
      await waitLoad(wc)
    }
    setCurUrl(wc.getURL() || url || getCurUrl())
    try {
      const raw = await wc.executeJavaScript(`(() => {
        ${INTERACTIVE_JS}
        const items = out.map((el, i) => {
          const tag = el.tagName.toLowerCase()
          const role = (el.getAttribute && el.getAttribute('role')) || ''
          let kind = tag
          if (tag === 'a' || role === 'link') kind = 'link'
          else if (tag === 'button' || role === 'button') kind = 'button'
          else if (tag === 'input') kind = (el.type === 'checkbox' || el.type === 'radio') ? el.type : 'textbox'
          else if (tag === 'textarea' || role === 'textbox') kind = 'textbox'
          else if (tag === 'select') kind = 'select'
          const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80)
          const placeholder = (el.getAttribute && el.getAttribute('placeholder')) || ''
          const label = (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('name'))) || ''
          const href = (el.getAttribute && el.getAttribute('href')) || ''
          const val = el.value !== undefined ? String(el.value).slice(0, 40) : ''
          const title = (label || placeholder || text || val || tag).slice(0, 80)
          return '@' + i + ' [' + kind + '] ' + title + (href ? ' -> ' + href : '') + (val ? ' value="' + val + '"' : '')
        })
        const bodyText = (document.body && document.body.innerText || '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 8000)
        return JSON.stringify({ title: document.title || '', url: location.href, text: bodyText, items: items.slice(0, 60) })
      })()`)
      const d = JSON.parse(raw)
      const lines = ['标题: ' + d.title, '网址: ' + d.url, '', '正文:', d.text || '(空页面)']
      if (d.items.length) lines.push('', '可交互元素(用于 browser_click/browser_type):', ...d.items)
      return lines.join('\n')
    } catch (e) { return 'E:页面快照失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 点击 @编号 元素
  ipcMain.handle('browser:click', async (_e, ref: string, taskKey?: string) => {
    const m = /^@(\d+)$/.exec(String(ref || '').trim())
    if (!m) return 'E:ref 格式应为 @编号(来自 browse 快照)'
    const idx = Number(m[1])
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    try {
      const r = await wc.executeJavaScript(`(() => {
        ${INTERACTIVE_JS}
        const el = out[${idx}]
        if (!el) return 'E:ref 不存在(页面已变化, 请重新 browse)'
        el.scrollIntoView({ block: 'center' })
        el.focus()
        el.click()
        return 'ok:' + (el.innerText || el.getAttribute('href') || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 60)
      })()`)
      setCurUrl(wc.getURL() || getCurUrl())
      return r
    } catch (e) { return 'E:点击失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 向 @编号 输入框输入文字
  ipcMain.handle('browser:type', async (_e, ref: string, text: string, taskKey?: string) => {
    const m = /^@(\d+)$/.exec(String(ref || '').trim())
    if (!m) return 'E:ref 格式应为 @编号'
    const idx = Number(m[1])
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    const textJs = JSON.stringify(String(text || ''))
    try {
      const r = await wc.executeJavaScript(`(() => {
        ${INTERACTIVE_JS}
        const el = out[${idx}]
        if (!el) return 'E:ref 不存在(页面已变化, 请重新 browse)'
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return 'E:目标不是输入框'
        el.scrollIntoView({ block: 'center' })
        el.focus()
        if (el.isContentEditable) {
          el.textContent = ${textJs}
        } else {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
          setter.call(el, ${textJs})
        }
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return 'ok'
      })()`)
      return r
    } catch (e) { return 'E:输入失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 按键(Enter/Escape/Tab/ArrowDown 等)
  ipcMain.handle('browser:press', async (_e, key: string, taskKey?: string) => {
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    const keyJs = JSON.stringify(String(key || ''))
    try {
      const r = await wc.executeJavaScript(`(() => {
        const target = document.activeElement || document.body
        const key = ${keyJs}
        const opts = { key, code: key, bubbles: true, cancelable: true }
        target.dispatchEvent(new KeyboardEvent('keydown', opts))
        target.dispatchEvent(new KeyboardEvent('keyup', opts))
        return 'ok:' + key
      })()`)
      return r
    } catch (e) { return 'E:按键失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 滚动
  ipcMain.handle('browser:scroll', async (_e, direction: string, taskKey?: string) => {
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    const delta = String(direction || 'down') === 'up' ? -700 : 700
    try {
      const y = await wc.executeJavaScript(`(() => { window.scrollBy(0, ${delta}); return window.scrollY })()`)
      return 'ok:scrollY=' + y
    } catch (e) { return 'E:滚动失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 在系统默认浏览器打开(用户可随时跳到真实浏览器)
  ipcMain.handle('browser:openExternal', async (_e, url: string) => {
    if (!isSafeBrowserUrl(url)) return 'E:仅支持 http/https 网址'
    try { await shell.openExternal(url); return 'ok' } catch (e) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
  })
  // agent 工具调用 —— 打开页面并返回文本内容（保持旧 browse 语义）
  ipcMain.handle('browser:open', async (_e, url: string) => {
    showBrowserFloat() // agent 使用浏览器时弹出悬浮提示
    const bw = getBrowserWin(); const wc = bw.webContents
    try { await wc.loadURL(url) } catch (e) { /* 继续 */ console.debug('[swallow]', e) }
    await waitLoad(wc)
    setCurUrl(wc.getURL() || url)
    try {
      const title = await wc.executeJavaScript('document.title')
      const text = await wc.executeJavaScript('document.body.innerText')
      return `${title}\n\n${String(text || '').slice(0, 10000)}`
    } catch { return '(load error)' }
  })
  // agent 工具调用 —— 截取当前页面（保持旧 browse_screenshot 语义）
  ipcMain.handle('browser:screenshot', async (_e, url?: string, taskKey?: string) => {
    showBrowserFloat() // agent 使用浏览器时弹出悬浮提示
    const bw = winFor(taskKey); const wc = bw.webContents
    if (url && url !== 'about:blank') { try { await wc.loadURL(url) } catch (e) { /* 继续 */ console.debug('[swallow]', e) } await waitLoad(wc) }
    setCurUrl(wc.getURL() || url || getCurUrl())
    try {
      const img = await wc.capturePage()
      return img.toDataURL()
    } catch { return '' }
  })
  // v0.3.3: 在当前浏览器会话页面执行 JavaScript 并返回结果
  ipcMain.handle('browser:console', async (_e, expression: string, taskKey?: string) => {
    const bw = winFor(taskKey); const wc = bw.webContents
    if (!wc || wc.isDestroyed()) return 'E:浏览器未就绪'
    const expr = JSON.stringify(String(expression || ''))
    try {
      const r = await wc.executeJavaScript(`(() => {
        try {
          const v = eval(${expr})
          return { ok: true, value: typeof v === 'string' ? v : JSON.stringify(v) }
        } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
      })()`)
      if (r && r.ok) return String(r.value).slice(0, 8000)
      return 'E:' + String((r && r.error) || '执行失败')
    } catch (e) { return 'E:执行失败: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // 任务结束关闭该任务的浏览器会话(隔离, 不串页面)
  ipcMain.handle('browser:closeSession', (_e, key: string) => {
    if (key) {
      if (activeBrowserKey === key) activeBrowserKey = ''
      closeBrowserSession(key)
    }
    return true
  })
}
