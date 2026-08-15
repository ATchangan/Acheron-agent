// electron/ipc/settings.ts —— 设置域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { writeFileAtomic, writeFileAtomicIfChanged } from '../fs-atomic'

export function registerSettingsIpc(deps: {
  settingsPath: string
  userDataPath: string
  decProviders: (d: unknown) => Record<string, unknown>
  encProviders: (d: unknown) => Record<string, unknown>
}): void {
  const { settingsPath, userDataPath, decProviders, encProviders } = deps
  ipcMain.handle('settings:load', () => {
    try {
      if (fs.existsSync(settingsPath)) {
        const raw = fs.readFileSync(settingsPath, 'utf-8')
        if (raw.trim()) {
          const data = JSON.parse(raw)
          // API Key 解密(DPAPI) —— 必须合并返回值(decProviders 返回新对象)
          Object.assign(data, decProviders(data))
          // 从独立文件读回大字段
          const g = data?.general || {}
          for (const [key, file] of [['bgImage', 'bgimage.dat']] as [string, string][]) {
            const v = g[key]
            if (typeof v === 'string' && v.startsWith('__FILE__')) {
              try { const fv = fs.readFileSync(join(userDataPath, file), 'utf-8'); g[key] = fv } catch { delete g[key] }
            }
          }
          if (g !== data?.general) data.general = g
          return data
        }
      }
    } catch (e) {
      // v0.3.7: 加载失败先备份坏文件再降级默认配置, 绝不直接覆盖原文件(曾因 BOM 事故丢过配置)
      try {
        const bad = settingsPath + '.bad-' + Date.now()
        fs.copyFileSync(settingsPath, bad)
        console.error('[SETTINGS] load error (backed up to ' + bad + '):', e)
      } catch (e2) { console.error('[SETTINGS] backup failed:', e2) }
    }
    return { providers: [], general: { theme: 'dark' } }
  })
  ipcMain.handle('settings:save', (_e, s) => {
    try {
      fs.mkdirSync(userDataPath, { recursive: true })
      // 大字段(背景图 base64)剥离到独立文件, 避免每次保存全量写阻塞
      const g = s?.general || {}
      const bigKeys: [string, string][] = [['bgImage', 'bgimage.dat']]
      const g2 = { ...g }
      for (const [key, file] of bigKeys) {
        const v = g2[key]
        if (typeof v === 'string' && v.length > 1024) {
          try { writeFileAtomic(join(userDataPath, file), v) } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
          g2[key] = '__FILE__' + file
        } else if (v === undefined || v === null) {
          // 数据安全 —— 删除大字段文件前先备份 .bak(壁纸曾因异常被删且无法找回)
          try {
            const fp = join(userDataPath, file)
            if (fs.existsSync(fp)) fs.copyFileSync(fp, fp + '.bak')
            fs.rmSync(fp, { force: true })
          } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
        }
      }
      // v0.4.x: 主进程私有字段合并 —— 插件状态等由主进程侧写入的字段, 渲染层全量保存时不得清空
      try {
        const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
        const diskG = onDisk?.general || {}
        for (const key of ['pluginStates'] as const) {
          if (g2[key] === undefined && diskG[key] !== undefined) g2[key] = diskG[key]
        }
      } catch { /* 首次保存无旧文件 */ }
      const slim = { ...s, general: g2 }
      // v0.3.0: 自定义工作目录 —— 目录不存在时自动创建(输入新路径即可直接使用)
      try {
        const wd = g2?.workDir
        if (typeof wd === 'string' && wd.trim()) fs.mkdirSync(wd.trim(), { recursive: true })
      } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
      // API Key 加密落盘(DPAPI)
      writeFileAtomicIfChanged(settingsPath, JSON.stringify(encProviders(slim)))
      return true
    } catch (e) { console.error('[SETTINGS] save error:', e); return false }
  })
}
