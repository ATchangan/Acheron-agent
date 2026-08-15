// electron/ipc/plugins.ts —— 插件域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { exec } from 'child_process'
import { invalidatePluginToolSpecCache, bustPluginCache, isPluginDisabled, readPluginStates } from '../plugins/author'
import { writeFileAtomic } from '../fs-atomic'
import { requestRiskConfirm } from './risk-confirm'
import { isMutatingCommand } from '../security/permission'
import { handleHostCall, type PluginPolicyEnv } from '../plugins/plugin-policy'
import { runPluginInMain, type HostDone } from '../plugins/host-core'
import { runPluginInUtility } from '../plugins/plugin-runner'

export function registerPluginsIpc(deps: {
  userDataPath: string
  settingsPath: string
  assessRisk: (e: { type: string; command: string }) => string
  getEffectiveWorkDir: () => string | undefined
}): void {
  const { userDataPath, settingsPath, assessRisk, getEffectiveWorkDir } = deps

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
      cp.on('close', (code: number) => {
        if (code === 0) { invalidatePluginToolSpecCache(); resolve('Plugin installed: ' + name) }
        else resolve('Error: ' + (errOut.trim() || 'git clone 失败, code ' + code))
      })
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
      if (fs.existsSync(dir)) {
        bustPluginCache(join(userDataPath, 'plugins'), name)
        fs.rmSync(dir, { recursive: true, force: true })
        invalidatePluginToolSpecCache()
        return true
      }
      return 'Error: plugin not found'
    } catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // v0.4.x: 插件启用/禁用与分类状态, 从 memory.json 迁到 settings.json(修复 v0.4.0 SQLite 迁移后状态不持久化的老问题)
  ipcMain.handle('plugins:getState', () => readPluginStates(settingsPath))
  ipcMain.handle('plugins:setState', (_e, state: Record<string, { enabled?: boolean; category?: string }>) => {
    try {
      const d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      d.general = d.general || {}
      d.general.pluginStates = state && typeof state === 'object' ? state : {}
      writeFileAtomic(settingsPath, JSON.stringify(d, null, 2))
      invalidatePluginToolSpecCache()
      return true
    } catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  // ─── 插件执行层 —— 独立进程 + ask 权限 + 超时强杀 + 4KB 截断(utilityProcess 不可用时回落同进程 vm) ──
  const readPluginPerm = (): Record<string, string> => {
    try { return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.pluginPerm || {} } catch { return {} }
  }
  const writePluginPerm = (perm: Record<string, string>): void => {
    try {
      const d = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      d.general = d.general || {}
      d.general.pluginPerm = perm
      writeFileAtomic(settingsPath, JSON.stringify(d, null, 2))
    } catch (e: unknown) { console.warn('[plugin] 权限写入失败:', e instanceof Error ? e.message : String(e)) }
  }
  ipcMain.handle('plugins:exec', async (_e, payload: { plugin: string; tool: string; args: Record<string, unknown>; sid?: string; taskId?: string; workDir?: string }) => {
    try {
      const { plugin, tool, args, sid, taskId, workDir } = payload || {}
      const pluginsDir = join(userDataPath, 'plugins')
      // 0. 插件级禁用: UI 关闭后不注入、不可执行
      if (isPluginDisabled(settingsPath, String(plugin))) return 'E:插件已被禁用: ' + plugin
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
          detail: '插件运行在独立进程中: 文件操作仅限工作目录; 会改变系统状态的命令逐条弹确认, 危险命令直接拦截。',
          buttons: ['允许一次', '始终允许', '拒绝'], defaultId: 0, cancelId: 2,
        })
        if (r.response === 2) { perm[key] = 'deny'; writePluginPerm(perm); return 'E:用户拒绝了插件工具调用' }
        if (r.response === 1) { perm[key] = 'allow'; writePluginPerm(perm) }
      }
      // 3. 任务级工作目录优先(经 set_workdir 切换), 所有特权操作经父进程策略裁决
      const effectiveWorkDir = (workDir && String(workDir).trim()) || getEffectiveWorkDir() || ''
      const env: PluginPolicyEnv = {
        workDir: effectiveWorkDir,
        isDangerous: cmd => assessRisk({ type: 'terminal', command: cmd }) === 'L4',
        isMutating: isMutatingCommand,
        confirmCommand: async (cmd: string): Promise<'allow' | 'deny'> => {
          try {
            const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
            if (s?.general?.riskAutoApprove === true) return 'allow'
            if (s?.general?.riskConfirm === false) return 'allow'
            if (Array.isArray(s?.general?.riskAlwaysAllow) && s.general.riskAlwaysAllow.includes('插件命令')) return 'allow'
          } catch { /* 设置缺失走确认 */ }
          const d = await requestRiskConfirm({ kind: '插件命令', detail: cmd, level: 'L2', sid, taskId })
          return d === 'allow' ? 'allow' : 'deny'
        },
        runCommand: cmd => new Promise<string>(r => exec(cmd, { cwd: effectiveWorkDir, timeout: 15000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => r((stdout || '') + (stderr ? '\n[stderr] ' + stderr.slice(0, 500) : '') + (err ? '\n[exit] ' + err.message : '')))),
        readFile: p => fs.readFileSync(p, 'utf-8'),
        writeFile: (p, c) => fs.writeFileSync(p, c, 'utf-8'),
      }
      const handleCall = (n: string, a: Record<string, unknown>) => handleHostCall(n, a, env)
      // 插件设置: manifest.settings 声明的 schema 默认值 + settings.json 中用户保存值, 以 ctx.settings 注入运行时
      const manifest = (() => { try { return JSON.parse(fs.readFileSync(join(pluginsDir, String(plugin), 'manifest.json'), 'utf-8')) } catch { return {} } })() as { settings?: { key: string; type?: string; default?: unknown; options?: string[] }[] }
      const saved = (() => {
        try {
          const g = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general
          return (g && typeof g.pluginSettings === 'object' && g.pluginSettings[String(plugin)]) || {}
        } catch { return {} }
      })() as Record<string, unknown>
      const settings: Record<string, unknown> = {}
      for (const d of Array.isArray(manifest.settings) ? manifest.settings : []) {
        settings[d.key] = saved[d.key] !== undefined ? saved[d.key]
          : d.default !== undefined ? d.default
          : d.type === 'number' ? 0 : d.type === 'boolean' ? false : (Array.isArray(d.options) && d.options.length ? d.options[0] : '')
      }
      const hostPayload = { code: fs.readFileSync(join(pluginsDir, String(plugin), 'index.js'), 'utf-8'), tool: String(tool), args: args || {}, settings }
      // 4. 独立进程执行(挂死强杀/崩溃隔离), utilityProcess 异常时回落同进程 vm(权限边界不变)
      let done: HostDone
      try {
        done = await runPluginInUtility(join(__dirname, '..', 'plugins', 'plugin-host.js'), hostPayload, handleCall)
      } catch (e: unknown) {
        console.debug('[plugin] utilityProcess 不可用, 回落同进程 vm:', e instanceof Error ? e.message : String(e))
        done = await runPluginInMain(hostPayload, handleCall)
      }
      if (!done.ok) return 'E:PLUGIN_ERR: ' + (done.error || '插件执行失败')
      const s = String(done.result ?? '')
      const logs = done.logs || []
      return s.length > 4000 ? s.slice(0, 4000) + '...[截断, 共 ' + s.length + ' 字符]' : (s + (logs.length ? '\n[插件日志]\n' + logs.join('\n').slice(0, 1000) : ''))
    } catch (e: unknown) { return 'E:PLUGIN_ERR: ' + ((e instanceof Error ? e.message : String(e))) }
  })
}
