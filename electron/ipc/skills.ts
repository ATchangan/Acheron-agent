// electron/ipc/skills.ts —— 技能域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { join, resolve } from 'path'
import { queryAudit, skillStats, type AuditResult } from '../db'
import { validateSkill } from '../engine/skill-files'
import { TOOLS } from '../engine/tool-specs'

export function registerSkillsIpc(deps: {
  skillsDir: string
  resourcesDir: string
}): void {
  const { skillsDir, resourcesDir } = deps
  // v0.4.3 已知工具集合(校验 tools 字段是否存在)
  const knownTools = new Set(TOOLS.map(t => t.function.name))

  ipcMain.handle('skills:list', () => {
    try {
      // 用户目录优先: 同名技能以用户版为准(可删/可改), 内置只补空缺
      const dirs: { path: string; builtin: boolean }[] = []
      if (fs.existsSync(skillsDir)) dirs.push({ path: join(skillsDir), builtin: false })
      dirs.push({ path: join(resourcesDir, 'skills'), builtin: true })
      const byName = new Map<string, { name: string; path: string; description: string; builtin: boolean }>()
      for (const { path: dir, builtin } of dirs) {
        if (!fs.existsSync(dir)) continue
        for (const entry of fs.readdirSync(dir)) {
          const skillDir = join(dir, entry)
          const mdPath = join(skillDir, 'SKILL.md')
          if (fs.existsSync(mdPath)) {
            const content = fs.readFileSync(mdPath, 'utf-8')
            const desc = (content.match(/description:\s*(.+)/i)?.[1] || entry).trim()
            byName.set(entry, { name: entry, path: mdPath, description: desc, builtin })
          }
        }
      }
      return [...byName.values()]
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
    try {
      const n = String(name || '').trim()
      if (!/^[A-Za-z0-9-]{1,80}$/.test(n)) return 'Error: 技能名仅允许字母/数字/-（防路径穿越）'
      const v = validateSkill(String(content || ''), knownTools)
      if (!v.ok) return 'Error: 校验失败\n' + v.problems.map(p => (p.level === 'error' ? '[error] ' : '[warn] ') + p.msg).join('\n')
      const dir = join(skillsDir, n)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
      return true
    } catch (e: unknown) { const em = e instanceof Error ? e.message : String(e); return 'Error: ' + em }
  })
  // v0.4.3 技能校验: 返回 {ok, problems}
  ipcMain.handle('skills:validate', (_e, content: string) => validateSkill(String(content || ''), knownTools))
  // v0.4.3 技能写入: 校验通过才落盘(路径白名单防穿越)
  ipcMain.handle('skills:write', (_e, name: string, content: string) => {
    try {
      const n = String(name || '').trim()
      if (!/^[A-Za-z0-9-]{1,80}$/.test(n)) return 'Error: 技能名仅允许字母/数字/-（防路径穿越）'
      const v = validateSkill(String(content || ''), knownTools)
      if (!v.ok) return 'Error: 校验失败\n' + v.problems.map(p => (p.level === 'error' ? '[error] ' : '[warn] ') + p.msg).join('\n')
      const dir = join(skillsDir, n)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(join(dir, 'SKILL.md'), content, 'utf-8')
      return true
    } catch (e: unknown) { return 'Error: ' + ((e instanceof Error ? e.message : String(e))) }
  })
  // 本地技能安装 —— 复制本地技能目录到 skillsDir(只读源, 校验目录名)
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
    // spawn 替代 exec 拼接 —— 修复命令注入(url 含 ; && 等可执行任意命令)
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
      // 安全: 目录名白名单(与 create/write 同规格), 防 name="..\.." 路径穿越删除任意目录
      const safeName = String(name || '')
      if (!/^[A-Za-z0-9-]{1,80}$/.test(safeName)) return 'Error: 非法的技能目录名'
      // 自省整改: 资源包内置技能不可删除(只读), 只能通过设置→技能「隐藏」
      if (fs.existsSync(join(resourcesDir, 'skills', safeName, 'SKILL.md'))) {
        return '内置技能不能删除，可在 设置→技能 中点击「隐藏」'
      }
      const dir = join(skillsDir, safeName)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        return true
      }
      // 也尝试删除 resources/skills 下的
      const altDir = join(resourcesDir, 'skills', safeName)
      if (fs.existsSync(altDir)) {
        fs.rmSync(altDir, { recursive: true, force: true })
        return true
      }
      return 'Error: skill not found'
    } catch (e: unknown) { return 'Error: ' + ((e instanceof Error ? e.message : String(e))) }
  })

  // v0.4.3 程序记忆·技能自动沉淀(实验性): 从审计里挖掘反复出现的工具序列 → 建议生成可复用技能
  const toolHint: Record<string, string> = {
    read: '读取文件了解内容', ls: '列目录', grep: '搜索定位', find: '查找文件', write: '写入文件', edit: '编辑文件', apply_patch: '应用补丁', mkdir: '建目录', exec_command: '执行命令验证', git: 'Git 操作', web_search: '搜索网页', web_read: '读网页', codebox: '运行代码', terminal_run: '跑终端命令', recall_memory: '检索记忆', save_memory: '存记忆', dispatch: '并行分工', handoff: '交接角色',
  }
  ipcMain.handle('skills:suggest', (_e, minCount?: number) => {
    try {
      const rows = queryAudit({ limit: 600 })
      const groups = new Map<string, AuditResult[]>()
      for (const r of rows) {
        const key = (r.sid || 'x') + '::' + (r.taskId || 'x')
        const g = groups.get(key)
        if (g) g.push(r); else groups.set(key, [r])
      }
      const sigCount = new Map<string, { count: number; tools: string[]; example: string; recent: number }>()
      for (const [, rs] of groups) {
        const seq = [...rs].sort((a, b) => a.ts - b.ts)
        const tools: string[] = []
        for (const r of seq) { const t = r.tool; if (t && tools[tools.length - 1] !== t) tools.push(t) }
        const uniq = [...new Set(tools)]
        if (uniq.length < 3) continue
        const sig = tools.join('>')
        const cur = sigCount.get(sig)
        if (cur) { cur.count++; cur.recent = Math.max(cur.recent, seq[seq.length - 1]?.ts || 0) }
        else sigCount.set(sig, { count: 1, tools: uniq, example: seq[0]?.argsSummary || '', recent: seq[seq.length - 1]?.ts || 0 })
      }
      const threshold = Math.max(3, Number(minCount) || 4)
      return [...sigCount.entries()].filter(([, v]) => v.count >= threshold).map(([signature, v]) => ({ signature, ...v })).sort((a, b) => b.count - a.count).slice(0, 10)
    } catch { return [] }
  })

  ipcMain.handle('skills:createFromWorkflow', (_e, signature: string, name: string) => {
    try {
      const tools = String(signature || '').split('>').map(s => s.trim()).filter(Boolean)
      if (tools.length < 2) return 'Error: 无效的工作流签名'
      const safeName = String(name || '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 40)
      if (!safeName) return 'Error: 需要技能名称'
      const steps = tools.map((t, i) => `${i + 1}. ${toolHint[t] || ('调用 ' + t)}（${t}）`).join('\n')
      const triggers = tools.slice(0, 4).join('|')
      const md = `---\nname: ${safeName}\ndescription: 从使用历史沉淀的常用工作流: ${tools.join(' → ')}\ntriggers: ${triggers}\n---\n\n# ${safeName}\n\n> 自动沉淀建议(实验性)。请补充"适用场景/示例"后再启用；通用步骤模板已按历史工具序列生成，按需删改。\n\n## 适用场景\n（补充：哪些任务反复用到这套流程）\n\n## 通用步骤\n${steps}\n\n## 验证\n- 改动后运行验证命令（构建/测试/列出改动确认），未验证不得宣称完成\n`
      const dir = join(skillsDir, safeName)
      if (fs.existsSync(dir)) return 'Error: 同名技能已存在: ' + safeName
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(join(dir, 'SKILL.md'), md, 'utf-8')
      return true
    } catch (e: unknown) { return 'Error: ' + ((e instanceof Error ? e.message : String(e))) }
  })
  // v0.4.3 命中统计(按日聚合)
  ipcMain.handle('skills:stats', (_e, days?: number) => skillStats(Math.max(1, Math.min(365, Number(days) || 30))))
}
