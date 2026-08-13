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

// v0.3.9: 可写技能目录 —— 依次探测, 返回第一个可写目录(只读系统目录自动跳过)
export function writableSkillDir(dirs: string[]): string | null {
  for (const dir of dirs || []) {
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
export function listSkills(skillsDirs: string[]): SkillMeta[] {
  // 同名技能: 后扫描的目录优先(引擎目录顺序为 内置→用户, 用户同名覆盖内置)
  const byName = new Map<string, SkillMeta>()
  for (const dir of skillsDirs || []) {
    if (!dir || !fs.existsSync(dir)) continue
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      const mdPath = join(dir, entry, 'SKILL.md')
      if (!fs.existsSync(mdPath)) continue
      try {
        const content = fs.readFileSync(mdPath, 'utf-8')
        byName.set(entry, { name: entry, description: parseSkillDescription(content, entry) })
      } catch { byName.set(entry, { name: entry, description: entry }) }
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

// 扫描全部技能详情(名称/描述/triggers/正文); 同名后扫目录优先(用户覆盖内置)
export function scanSkillDetails(skillsDirs: string[]): SkillDetail[] {
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

// 按用户消息匹配技能: triggers 正则命中(权重2) > description 关键词命中(权重1); 返回 top N
export function matchSkills(skillsDirs: string[], query: string, limit = 2): SkillDetail[] {
  const q = String(query || '').trim()
  if (!q) return []
  const details = scanSkillDetails(skillsDirs)
  const scored = details.map(d => {
    let score = 0
    for (const t of d.triggers) {
      try { if (new RegExp(t, 'i').test(q)) { score += 2; break } } catch { /* 非法正则忽略 */ }
    }
    if (d.description && q && d.description.includes(q)) score += 1
    return { d, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map(x => x.d)
}
