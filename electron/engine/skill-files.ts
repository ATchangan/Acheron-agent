// electron/engine/skill-files.ts — 技能目录扫描/路径解析纯函数(可单测, 无 Electron 依赖)
import * as fs from 'fs'
import { join, resolve, sep } from 'path'

export interface SkillMeta { name: string; description: string }

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

// 扫描技能目录: 每个含 SKILL.md 的子目录视为一个技能
export function listSkills(skillsDirs: string[]): SkillMeta[] {
  const out: SkillMeta[] = []
  const seen = new Set<string>()
  for (const dir of skillsDirs || []) {
    if (!dir || !fs.existsSync(dir)) continue
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { continue }
    for (const entry of entries) {
      if (seen.has(entry)) continue
      const mdPath = join(dir, entry, 'SKILL.md')
      if (!fs.existsSync(mdPath)) continue
      seen.add(entry)
      try {
        const content = fs.readFileSync(mdPath, 'utf-8')
        out.push({ name: entry, description: parseSkillDescription(content, entry) })
      } catch { out.push({ name: entry, description: entry }) }
    }
  }
  return out
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
