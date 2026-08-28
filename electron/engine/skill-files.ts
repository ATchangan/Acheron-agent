// electron/engine/skill-files.ts — 技能目录扫描/路径解析纯函数(可单测, 无 Electron 依赖)
import * as fs from 'fs'
import { join, resolve, sep } from 'path'

export interface SkillMeta { name: string; description: string }

export interface SkillDetail extends SkillMeta { triggers: string[]; body: string }

// v0.3.9: 技能名净化 —— 防止路径穿越/非法字符
export function safeSkillName(name: string): string {
  const n = String(name || '').replace(/[\\/:*?"<>|]/g, '').replace(/^\.+|\.+$/g, '').trim()
  return n && n !== '.' && n !== '..' ? n.slice(0, 40) : ''
}

// v0.3.9: 可写技能目录 —— 从后往前探测, 优先用户目录(内置目录在开发态可写时会误选源码目录, 导致技能写进仓库)
export function writableSkillDir(dirs: string[]): string | null {
  for (const dir of [...(dirs || [])].reverse()) {
    if (!dir) continue
    try { fs.accessSync(dir, fs.constants.W_OK); return dir } catch { /* 跳过只读目录 */ }
  }
  return null
}

// 从 SKILL.md frontmatter 提取 description(name 兼容 YAML 引号)
export function parseSkillDescription(content: string, fallback: string): string {
  const m = content.match(/^---\s*[\s\S]*?description:\s*(.+)$/m)
  if (!m) return fallback
  return String(m[1]).trim().replace(/^["']|["']$/g, '').slice(0, 200)
}

// 解析 triggers(frontmatter 管道符分隔)与正文(去 frontmatter)
export function parseSkillDetail(name: string, content: string): SkillDetail {
  const triggersRaw = content.match(/^---\s*[\s\S]*?triggers:\s*(.+)$/m)?.[1] || ''
  const triggers = triggersRaw.split(/[|｜]/).map(t => t.trim()).filter(t => t.length >= 2)
  const body = content.replace(/^---\s*[\s\S]*?---\s*/, '').trim()
  return { name, description: parseSkillDescription(content, name), triggers, body }
}

// 扫描技能目录: 每个含 SKILL.md 的子目录视为一个技能
// v0.4.4 精简: 技能生态已从产品移除 —— 引擎侧不再装载/注入技能(工具调用/插件/会话流式回复为仅存能力)
// 扫描实现保留(scanSkillDetailCore)供迁移复用; 引擎调用点 listSkills/matchSkills 一律返回空集
export function listSkills(_skillsDirs: string[]): SkillMeta[] {
  return []
}

export function scanSkillDetails(skillsDirs: string[]): SkillDetail[] {
  return scanSkillDetailCore(skillsDirs)
}

function scanSkillDetailCore(skillsDirs: string[]): SkillDetail[] {
  const byName = new Map<string, SkillDetail>()
  for (const dir of skillsDirs || []) {
    if (!dir || !fs.existsSync(dir)) continue
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      const mdPath = join(dir, entry, 'SKILL.md')
      if (!fs.existsSync(mdPath)) continue
      try {
        const content = fs.readFileSync(mdPath, 'utf-8')
        byName.set(entry, parseSkillDetail(entry, content))
      } catch { byName.set(entry, { name: entry, description: entry, triggers: [], body: '' }) }
    }
  }
  return [...byName.values()]
}

// 解析技能内文件路径: 必须位于某个技能目录内(防越权), 返回绝对路径或 null
export function resolveSkillFile(skillsDirs: string[], name: string, file: string): string | null {
  const safeName = String(name || '').replace(/[\\/]/g, '')
  if (!safeName || safeName === '.' || safeName === '..') return null
  const rel = String(file || 'SKILL.md').replace(/^[\\/]+/, '')
  if (!rel || rel.includes('..')) return null
  for (const dir of skillsDirs || []) {
    if (!dir || !fs.existsSync(dir)) continue
    const candidate = join(dir, safeName, rel)
    try {
      const rp = resolve(candidate)
      const base = resolve(join(dir, safeName)) + sep
      if (rp.startsWith(base) && fs.existsSync(rp) && fs.statSync(rp).isFile()) return rp
    } catch { /* 忽略非法路径 */ }
  }
  return null
}

// 按用户消息匹配技能: triggers 正则命中(权重2) > description 关键词命中(权重1); 返回 top N
// v0.4.4 精简: 技能生态已移除, 恒返回空集(不注入技能正文)
export function matchSkills(_skillsDirs: string[], _query: string, _limit = 2): SkillDetail[] {
  return []
}

// v0.4.3 技能校验(4 规则): 必填/长度/正文结构/triggers 正则; 可选 tools 已知性(warn)
export interface SkillProblem { level: 'error' | 'warn'; msg: string }
export interface SkillValidation { ok: boolean; problems: SkillProblem[] }
export function validateSkill(content: string, knownTools?: Set<string>): SkillValidation {
  const problems: SkillProblem[] = []
  const fm = /^---\s*\n([\s\S]*?)\n---\s*\n/.exec(String(content || ''))
  if (!fm) {
    problems.push({ level: 'error', msg: 'frontmatter 缺失或格式错误（需以 --- 包裹）' })
    return { ok: false, problems }
  }
  const md = fm[1]
  const field = (k: string) => { const m = new RegExp('^' + k + '\\s*:\\s*(.+)$', 'm').exec(md); return m ? m[1].trim() : '' }
  const name = field('name'); const desc = field('description'); const triggers = field('triggers')
  if (!desc) problems.push({ level: 'error', msg: '缺少必填字段: description' })
  if (desc.length > 100) problems.push({ level: 'error', msg: 'description 超 100 字（当前 ' + desc.length + '）' })
  if (name && /[^A-Za-z0-9\-\u4e00-\u9ff5 ]/.test(name)) problems.push({ level: 'warn', msg: 'name 建议用字母/数字/-/中文' })
  if (!triggers) problems.push({ level: 'warn', msg: '缺少 triggers（不会按关键词自动匹配，只能手动或 read_skill 读取）' })
  else {
    for (const t of String(triggers || '').split('|').map(s => s.trim()).filter(Boolean)) {
      try { new RegExp(t) } catch { problems.push({ level: 'error', msg: 'triggers 非法正则: ' + t }) }
    }
  }
  const body = content.slice(fm[0].length)
  if (!/##\s*(步骤|执行步骤|操作|触发条件|指令|使用说明)/.test(body)) problems.push({ level: 'warn', msg: '正文建议含 "## 步骤/操作" 等结构标题' })
  const tools = field('tools')
  if (tools && knownTools) {
    for (const t of tools.split(/[|,]/).map(s => s.trim()).filter(Boolean)) {
      if (!knownTools.has(t)) problems.push({ level: 'warn', msg: '未知工具: ' + t + '（注入后可能无法调用）' })
    }
  }
  return { ok: !problems.some(p => p.level === 'error'), problems }
}
