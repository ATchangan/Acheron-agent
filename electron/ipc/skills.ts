// electron/ipc/skills.ts —— 技能域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { join, resolve } from 'path'

export function registerSkillsIpc(deps: {
  skillsDir: string
  resourcesDir: string
}): void {
  const { skillsDir, resourcesDir } = deps

  ipcMain.handle('skills:list', () => {
    try {
      const dirs = [join(resourcesDir, 'skills')]
      if (fs.existsSync(skillsDir)) dirs.push(skillsDir)
      const skills: { name: string; path: string; description: string }[] = []
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue
        for (const entry of fs.readdirSync(dir)) {
          const skillDir = join(dir, entry)
          const mdPath = join(skillDir, 'SKILL.md')
          if (fs.existsSync(mdPath)) {
            const content = fs.readFileSync(mdPath, 'utf-8')
            const desc = (content.match(/description:\s*(.+)/i)?.[1] || entry).trim()
            skills.push({ name: entry, path: mdPath, description: desc })
          }
        }
      }
      return skills
    } catch { return [] }
  })
  // 只允许读取技能目录内的文件(防越权读取任意路径)
  ipcMain.handle('skills:load', (_e, path: string) => {
    try {
      const p = String(path || '')
      const allowed = [join(skillsDir, ''), join(resourcesDir, 'skills', '')]
      const rp = resolve(p)
      if (!allowed.some(a => rp === resolve(a) || rp.startsWith(resolve(a)))) return ''
      return fs.readFileSync(rp, 'utf-8')
    }
    catch { return '' }
  })
  ipcMain.handle('skills:pickLocal', async () => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: '选择本地技能(目录或 .zip)',
        properties: ['openDirectory', 'openFile'],
        filters: [{ name: '技能包', extensions: ['zip'] }],
      })
      return canceled || !filePaths.length ? null : filePaths[0]
    } catch { return null }
  })
  ipcMain.handle('skills:create', (_e, name: string, content: string) => {
    console.log('[SKILLS:CREATE] called', name, 'skillsDir=', skillsDir)
    try {
      const dir = join(skillsDir, name)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
      console.log('[SKILLS:CREATE] ok', dir)
      return true
    } catch (e: unknown) { const em = e instanceof Error ? e.message : String(e); console.log('[SKILLS:CREATE] ERR', em); return 'Error: ' + em }
  })
  // v0.2.3: 本地技能安装 —— 复制本地技能目录到 skillsDir(只读源, 校验目录名)
  ipcMain.handle('skills:installLocal', async (_e, srcPath: string) => {
    try {
      const src = String(srcPath || '').trim()
      if (!fs.existsSync(src)) return 'Error: 路径不存在'
      const st = fs.statSync(src)
      const name = src.split(/[\\/]/).pop()!.replace(/\.git$/, '').replace(/[^\w\-. ]/g, '').trim()
      if (!/^[\w\-. ]{1,80}$/.test(name)) return 'Error: 无效的技能名称'
      const dest = join(skillsDir, name)
      if (fs.existsSync(dest)) return 'Error: 同名技能已存在: ' + name
      if (st.isDirectory()) {
        fs.cpSync(src, dest, { recursive: true })
      } else if (st.isFile() && src.endsWith('.zip')) {
        const { execFileSync } = require('child_process') as { execFileSync: (c: string, o: object, x?: object) => Buffer }
        fs.mkdirSync(dest, { recursive: true })
        try { execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Expand-Archive -Path "' + src.replace(/"/g, '`"') + '" -DestinationPath "' + dest.replace(/"/g, '`"') + '" -Force'], { timeout: 60000, windowsHide: true }) } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); return 'Error: 解压失败: ' + (e instanceof Error ? e.message : String(e)) }
      } else {
        return 'Error: 仅支持目录或 .zip 文件'
      }
      return 'OK 已安装: ' + name
    } catch (e: unknown) { return 'Error: ' + ((e instanceof Error ? e.message : String(e))) }
  })
  ipcMain.handle('skills:install', (_e, url: string) => {
    // v0.2.3-security: spawn 替代 exec 拼接 —— 修复命令注入(url 含 ; && 等可执行任意命令)
    return new Promise<string>(resolve2 => {
      const name = String(url || '').split('/').pop()?.replace(/\.git$/, '') || 'skill'
      if (!/^[\w\-.]{1,80}$/.test(name)) { resolve2('Error: 无效的技能名称'); return }
      if (!/^https?:\/\//i.test(String(url || ''))) { resolve2('Error: 仅支持 http(s) 仓库地址'); return }
      const dir = join(skillsDir, name)
      const { spawn } = require('child_process')
      const cp = spawn('git', ['clone', '--depth', '1', String(url), dir], { timeout: 30000, windowsHide: true })
      let errOut = ''
      cp.stderr?.on('data', (d: Buffer) => { errOut += d.toString(); if (errOut.length > 500) errOut = errOut.slice(-500) })
      cp.on('error', (e: unknown) => resolve2('Error: ' + (e instanceof Error ? e.message : String(e)) || 'git 启动失败'))
      cp.on('close', (code: number) => resolve2(code === 0 ? 'ok' : ('Error: ' + (errOut.trim() || 'git clone 失败, code ' + code))))
    })
  })
  ipcMain.handle('skills:delete', (_e, name: string) => {
    try {
      const dir = join(skillsDir, name)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        return true
      }
      // 也尝试删除 resources/skills 下的
      const altDir = join(resourcesDir, 'skills', name)
      if (fs.existsSync(altDir)) {
        fs.rmSync(altDir, { recursive: true, force: true })
        return true
      }
      return 'Error: skill not found'
    } catch (e: unknown) { return 'Error: ' + ((e instanceof Error ? e.message : String(e))) }
  })
}
