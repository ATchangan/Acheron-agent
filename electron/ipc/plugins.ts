// electron/ipc/plugins.ts —— 插件域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { exec } from 'child_process'

export function registerPluginsIpc(deps: {
  userDataPath: string
  settingsPath: string
  assertInsideWorkDir: (p: string) => boolean
  assessRisk: (e: { type: string; command: string }) => string
  getEffectiveWorkDir: () => string | undefined
}): void {
  const { userDataPath, settingsPath, assertInsideWorkDir, assessRisk, getEffectiveWorkDir } = deps

  ipcMain.handle('plugins:install', (_e, url: string) => {
    // spawn 替代 exec 拼接 —— 修复命令注入
    return new Promise<string>(resolve => {
      const dir = join(userDataPath, 'plugins')
      try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) } catch (e: unknown) { resolve('Error: cannot create plugins dir: ' + (e instanceof Error ? e.message : String(e))); return }
      const name = (String(url || '').split('/').pop() || 'plugin').replace(/\.git$/, '')
      if (!/^[\w\-.]{1,80}$/.test(name)) { resolve('Error: 无效的插件名称'); return }
      if (!/^https?:\/\//i.test(String(url || ''))) { resolve('Error: 仅支持 http(s) 仓库地址'); return }
      const target = join(dir, name)
      if (fs.existsSync(target)) { resolve('Error: plugin already exists: ' + name); return }
      const { spawn } = require('child_process')
      const cp = spawn('git', ['clone', '--depth', '1', String(url), target], { timeout: 30000, windowsHide: true })
      let errOut = ''
      cp.stderr?.on('data', (d: Buffer) => { errOut += d.toString(); if (errOut.length > 500) errOut = errOut.slice(-500) })
      cp.on('error', (e: unknown) => resolve('Error: ' + (e instanceof Error ? e.message : String(e)) || 'git 启动失败'))
      cp.on('close', (code: number) => resolve(code === 0 ? ('Plugin installed: ' + name) : ('Error: ' + (errOut.trim() || 'git clone 失败, code ' + code))))
    })
  })
  ipcMain.handle('plugins:scan', () => {
    try { return require('../plugins/loader').scanPlugins(join(userDataPath, 'plugins')) } catch {
      // fallback: read directory
      try {
        const dir = join(userDataPath, 'plugins')
        if (!fs.existsSync(dir)) return []
        return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => ({ name: d.name, version: 'unknown' }))
      } catch { return [] }
    }
  })
  ipcMain.handle('plugins:tools', () => { try { return require('../plugins/loader').getPluginImplTools(join(userDataPath, 'plugins')) } catch { return [] } })
  ipcMain.handle('plugins:delete', (_e, name: string) => {
    try {
      const dir = join(userDataPath, 'plugins', name)
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); return true }
      return 'Error: plugin not found'
    } catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // ─── v0.3.0 M4: 插件执行层 —— vm 沙箱 + ask 权限 + 10s 超时 + 4KB 截断 ──
  const vm = require('vm')
  const readPluginPerm = (): Record<string, string> => {
    try { return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.pluginPerm || {} } catch { return {} }
  }
  const writePluginPerm = (perm: Record<string, string>): void => {
    try {
      const d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      d.general = d.general || {}
      d.general.pluginPerm = perm
      fs.writeFileSync(settingsPath, JSON.stringify(d, null, 2), 'utf-8')
    } catch (e: unknown) { console.warn('[plugin] 权限写入失败:', e instanceof Error ? e.message : String(e)) }
  }
  // 插件工具桥: 只走既有权限校验(L0-L4 复用) —— 插件无法绕过
  const pluginBridgeTools: Record<string, (a: Record<string, unknown>) => Promise<string>> = {
    read: async (a: Record<string, unknown>) => { const p = String(a?.path || ''); if (!assertInsideWorkDir(p)) return 'E:仅允许读取工作目录内的文件'; try { return fs.readFileSync(p, 'utf-8').slice(0, 8000) } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) } },
    write: async (a: Record<string, unknown>) => { const p = String(a?.path || ''); if (!assertInsideWorkDir(p)) return 'E:仅允许写入工作目录内的文件'; try { fs.writeFileSync(p, String(a?.content ?? ''), 'utf-8'); return 'ok' } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) } },
    exec_command: async (a: Record<string, unknown>) => { const cmd = String(a?.cmd || ''); if (assessRisk({ type: 'terminal', command: cmd }) === 'L4') return 'E:permission denied: 危险命令已被拦截'; return new Promise<string>(r => exec(cmd, { cwd: getEffectiveWorkDir(), timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => r((stdout || '') + (stderr ? '\n[stderr] ' + stderr.slice(0, 500) : '') + (err ? '\n[exit] ' + err.message : '')))) },
  }
  ipcMain.handle('plugins:exec', async (_e, payload: { plugin: string; tool: string; args: Record<string, unknown> }) => {
    try {
      const { plugin, tool, args } = payload || {}
      const pluginsDir = join(userDataPath, 'plugins')
      // 1. 校验 plugin/tool 在已扫描实现清单内(防任意路径注入)
      const loader = require('../plugins/loader')
      if (!loader.isPluginToolValid(pluginsDir, String(plugin), String(tool))) return 'E:PLUGIN_UNKNOWN: ' + plugin + '/' + tool
      // 2. 权限: allow 放行 / deny 拒绝 / 默认 ask(首次调用弹确认)
      const key = String(plugin) + ':' + String(tool)
      const perm = readPluginPerm()
      if (perm[key] === 'deny') return 'E:插件工具已被禁用: ' + key
      if (perm[key] !== 'allow') {
        const win = BrowserWindow.getAllWindows()[0]
        const r = await dialog.showMessageBox(win, {
          type: 'question', title: '插件工具请求执行',
          message: `插件「${plugin}」的工具「${tool}」请求执行。`,
          detail: '插件运行在沙箱中: 文件操作仅限工作目录, 命令执行受危险命令拦截。',
          buttons: ['允许一次', '始终允许', '拒绝'], defaultId: 0, cancelId: 2,
        })
        if (r.response === 2) { perm[key] = 'deny'; writePluginPerm(perm); return 'E:用户拒绝了插件工具调用' }
        if (r.response === 1) { perm[key] = 'allow'; writePluginPerm(perm) }
      }
      // 3. vm 沙箱执行 index.js(require 白名单: path + fs 只读子集)
      const idx = join(pluginsDir, String(plugin), 'index.js')
      const code = fs.readFileSync(idx, 'utf-8')
      const logs: string[] = []
      const sandboxRequire = (modName: string): unknown => {
        if (modName === 'path' || modName === 'node:path') return require('path')
        if (modName === 'fs' || modName === 'node:fs') {
          // v0.3.1 补丁: fs 白名单全部包一层工作目录校验 —— 插件禁止读取工作目录外的任意文件
          const guardRead = (p: unknown): string => {
            const path = String(p ?? '')
            if (!assertInsideWorkDir(path)) throw new Error('E:仅允许读取工作目录内的文件')
            return path
          }
          const f: Record<string, unknown> = {
            readFileSync: (p: unknown, ...a: unknown[]) => fs.readFileSync(guardRead(p), ...(a as [never])),
            readdirSync: (p: unknown, ...a: unknown[]) => fs.readdirSync(guardRead(p), ...(a as [never])),
            existsSync: (p: unknown) => { const q = String(p ?? ''); return assertInsideWorkDir(q) && fs.existsSync(q) },
            statSync: (p: unknown) => fs.statSync(guardRead(p)),
            readFile: (p: unknown, ...a: unknown[]) => fs.promises.readFile(guardRead(p), ...(a as [never])),
            readdir: (p: unknown, ...a: unknown[]) => fs.promises.readdir(guardRead(p), ...(a as [never])),
          }
          return f
        }
        throw new Error('E:PLUGIN_FORBIDDEN: ' + modName)
      }
      const sandbox = {
        module: { exports: {} }, exports: {},
        require: sandboxRequire,
        console: { log: (m: unknown) => logs.push(String(m)), warn: (m: unknown) => logs.push('warn: ' + m), error: (m: unknown) => logs.push('error: ' + m) },
        setTimeout, clearTimeout,
        log: (m: unknown) => logs.push(String(m)),
        tools: { run: async (n: string, a: Record<string, unknown>) => { const fn = pluginBridgeTools[n]; return fn ? await fn(a || {}) : 'E:未知工具: ' + n } },
      }
      const vmCtx = vm.createContext(sandbox)
      vm.runInContext(code, vmCtx, { timeout: 10000 })
      const exportsInSandbox = vm.runInContext('module.exports', vmCtx, { timeout: 1000 })
      const toolDef = (Array.isArray(exportsInSandbox?.tools) ? exportsInSandbox.tools : []).find((t: { name?: string }) => t?.name === tool)
      if (!toolDef || typeof toolDef.run !== 'function') return 'E:PLUGIN_NO_RUN: ' + tool
      // 4. 执行(run 可为同步或 Promise), 10s 超时
      const result = await Promise.race([
        Promise.resolve().then(() => toolDef.run(args || {}, { log: sandbox.log, tools: sandbox.tools })),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('E:PLUGIN_TIMEOUT(10s)')), 10000)),
      ])
      const s = String(result ?? '')
      return s.length > 4000 ? s.slice(0, 4000) + '...[截断, 共 ' + s.length + ' 字符]' : (s + (logs.length ? '\n[插件日志]\n' + logs.join('\n').slice(0, 1000) : ''))
    } catch (e: unknown) { return 'E:PLUGIN_ERR: ' + ((e instanceof Error ? e.message : String(e))) }
  })
}
