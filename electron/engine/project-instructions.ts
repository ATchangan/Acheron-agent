// electron/engine/project-instructions.ts —— 项目指令发现与注入
// 发现语义: AGENTS.override.md > AGENTS.md > CLAUDE.md > .agents.md(每目录至多一个),
// git 根 → 工作目录逐层合并, 深层靠后优先, 合并上限默认 32 KiB(可配置), 超限打截断标记
// 注入策略: 启动只注入工作目录链; 读取子目录文件时按需注入该目录(最多上溯 5 层)规则
import * as fs from 'fs'
import { dirname, join, relative } from 'path'

export const INSTRUCTION_FILES = ['AGENTS.override.md', 'AGENTS.md', 'CLAUDE.md', '.agents.md']
export const SUBDIR_FILE_CAP_CHARS = 8000
export const MAX_ANCESTORS = 5

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+)?(rules|instructions)/i,
  /system\s+prompt\s+override/i,
  /do\s+not\s+tell\s+the\s+user/i,
  /<!--\s*system/i,
]

export interface InstructionFile {
  path: string
  content: string
  truncated?: boolean
}

export interface ProjectInstructions {
  files: InstructionFile[]
  content: string
  truncated: boolean
  maxBytes: number
  dirs: string[] // 已覆盖的目录(根→工作目录), 子目录按需注入时用于跳过
}

// 单目录解析: override > AGENTS.md > CLAUDE.md > .agents.md, 命中即止
export function resolveInstructionFile(dir: string): string | null {
  for (const name of INSTRUCTION_FILES) {
    try {
      const p = join(dir, name)
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p
    } catch { /* 单个文件检查失败继续 */ }
  }
  return null
}

export function findGitRoot(startDir: string): string | null {
  let cur = startDir
  for (;;) {
    try {
      if (fs.existsSync(join(cur, '.git'))) return cur
    } catch { return null }
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
}

// 只读文件前缀(字节), 避免超大指令文件整读进内存
function readFilePrefix(p: string, maxBytes: number): string {
  const fd = fs.openSync(p, 'r')
  try {
    const size = fs.statSync(p).size
    const len = Math.min(size, maxBytes)
    const buf = Buffer.allocUnsafe(len)
    fs.readSync(fd, buf, 0, len, 0)
    return buf.toString('utf-8').replace(/[\uFFFD]+$/, '')
  } finally {
    fs.closeSync(fd)
  }
}

// 目录链: git 根 → 工作目录(升序); 不在 git 仓库时只有工作目录
export function chainDirs(workDir: string): string[] {
  const root = findGitRoot(workDir) || workDir
  const dirs: string[] = []
  let cur = workDir
  for (;;) {
    dirs.push(cur)
    if (cur === root) break
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return dirs.reverse()
}

export function readInstructionFile(p: string, capChars = Infinity, maxReadBytes = Infinity): InstructionFile | null {
  try {
    const size = fs.statSync(p).size
    if (!size) return null
    const raw = maxReadBytes === Infinity ? fs.readFileSync(p, 'utf-8') : readFilePrefix(p, maxReadBytes)
    if (!raw.trim()) return null
    if (raw.length <= capChars) return { path: p, content: raw }
    return { path: p, content: raw.slice(0, capChars) + '\n...[项目指令超长已截断]', truncated: true }
  } catch { return null }
}

// 注入前安全扫描: 命中可疑提示注入模式的指令文件跳过
export function hasInjectionRisk(content: string): boolean {
  return INJECTION_PATTERNS.some(re => re.test(content))
}

export function formatInstructionFiles(files: InstructionFile[], maxBytes: number): { text: string; truncated: boolean } {
  const parts = files.map(f => `## ${f.path}\n${f.content}`)
  const full = parts.join('\n\n')
  const buf = Buffer.from(full, 'utf-8')
  if (buf.length <= maxBytes) return { text: full, truncated: false }
  const cut = buf.subarray(0, maxBytes).toString('utf-8').replace(/[\uFFFD]+$/, '')
  return {
    text: cut + '\n\n[项目指令已截断: 合并内容超过 ' + Math.round(maxBytes / 1024) + ' KiB, 仅保留开头]',
    truncated: true,
  }
}

export interface InstructionFrontmatter {
  paths?: string[]
}

// 解析单文件内路径作用域 frontmatter(简易 YAML 子集):
// ---
// paths:
//   - src/**
//   - "*.ts"
// ---
export function parseInstructionFrontmatter(raw: string): { frontmatter: InstructionFrontmatter; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---')
  if (end < 0) return { frontmatter: {}, body: raw }
  const fm = raw.slice(3, end).trim()
  const body = raw.slice(end + 4)
  const paths: string[] = []
  let inList = false
  for (const line of fm.split('\n')) {
    if (inList) {
      const item = line.match(/^\s*-\s*(.+)$/)
      if (!item) { inList = false; continue }
      const v = item[1].trim().replace(/^['"]|['"]$/g, '')
      if (v) paths.push(v)
      continue
    }
    const m = line.match(/^\s*paths\s*:\s*(.*)$/)
    if (!m) continue
    const v = m[1].trim()
    if (v.startsWith('[')) {
      for (const s of v.slice(1, -1).split(',')) {
        const item = s.trim().replace(/^['"]|['"]$/g, '')
        if (item) paths.push(item)
      }
    } else if (v) {
      paths.push(v.replace(/^['"]|['"]$/g, ''))
    } else {
      inList = true
    }
  }
  return { frontmatter: paths.length ? { paths } : {}, body }
}

// 通配匹配: 支持 ** 跨目录、* 单段、? 单字符, 路径统一正斜杠
export function matchPathPattern(relPath: string, pattern: string): boolean {
  const p = relPath.replace(/\\/g, '/')
  const pat = pattern.trim().replace(/\\/g, '/')
  if (!pat) return false
  const rx = '^' + pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]') + '$'
  try { return new RegExp(rx).test(p) } catch { return false }
}

// 触达路径相对规则文件目录, 与 paths 任一模式匹配即生效
export function matchesAnyScope(touchedPath: string, dir: string, patterns: string[]): boolean {
  const rel = relative(dir, touchedPath).replace(/\\/g, '/')
  return patterns.some(pat => matchPathPattern(rel, pat))
}

// 启动发现: 目录链合并 + 注入扫描 + 合并上限
export function discoverProjectInstructions(workDir: string, maxBytes = 32 * 1024): ProjectInstructions | null {
  const dirs = chainDirs(workDir)
  const files: InstructionFile[] = []
  for (const dir of dirs) {
    const p = resolveInstructionFile(dir)
    if (!p) continue
    const f = readInstructionFile(p, Infinity, maxBytes)
    if (!f || hasInjectionRisk(f.content)) continue
    files.push(f)
  }
  if (!files.length) return null
  const combined = formatInstructionFiles(files, maxBytes)
  return { files, content: combined.text, truncated: combined.truncated, maxBytes, dirs }
}

// 子目录按需注入: 从文件所在目录往上最多 5 层, 已访问目录跳过, 单文件 8k 上限
export function collectSubdirInstructions(path: string, visited: Set<string>): InstructionFile[] {
  const out: InstructionFile[] = []
  let dir = path
  for (let i = 0; i <= MAX_ANCESTORS; i++) {
    try {
      if (!fs.statSync(dir).isDirectory()) dir = dirname(dir)
    } catch {
      // 文件不存在或不可访问: 按文件处理, 上溯一层继续找目录规则
      dir = dirname(dir)
    }
    if (visited.has(dir)) { dir = dirname(dir); continue }
    const p = resolveInstructionFile(dir)
    let handled = false
    if (p) {
      const f = readInstructionFile(p, SUBDIR_FILE_CAP_CHARS, SUBDIR_FILE_CAP_CHARS * 4)
      if (f && !hasInjectionRisk(f.content)) {
        const parsed = parseInstructionFrontmatter(f.content)
        const body = parsed.body.trim()
        const scoped = (parsed.frontmatter.paths || []).length > 0
        if (body && (!scoped || matchesAnyScope(path, dir, parsed.frontmatter.paths!))) {
          out.push({ path: p, content: body, truncated: f.truncated })
          visited.add(dir) // 规则已注入(含作用域命中): 本会话不再重复
          handled = true
        } else {
          // 路径作用域不匹配: 不注入、不标记已访问, 留给其它路径后续触发
          dir = dirname(dir)
          continue
        }
      }
    }
    // 无规则文件 / 注入风险 / 空正文: 标记已访问, 避免重复扫描
    if (!handled) visited.add(dir)
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}
