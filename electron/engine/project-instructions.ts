// electron/engine/project-instructions.ts —— 项目指令发现与注入
// 发现语义: AGENTS.override.md > AGENTS.md > CLAUDE.md > .agents.md(每目录至多一个),
// git 根 → 工作目录逐层合并, 深层靠后优先, 合并上限默认 32 KiB(可配置), 超限打截断标记
// 注入策略: 启动只注入工作目录链; 读取子目录文件时按需注入该目录(最多上溯 5 层)规则
import * as fs from 'fs'
import { dirname, join } from 'path'

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

export function readInstructionFile(p: string, capChars = Infinity): InstructionFile | null {
  try {
    const raw = fs.readFileSync(p, 'utf-8')
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

// 启动发现: 目录链合并 + 注入扫描 + 合并上限
export function discoverProjectInstructions(workDir: string, maxBytes = 32 * 1024): ProjectInstructions | null {
  const dirs = chainDirs(workDir)
  const files: InstructionFile[] = []
  for (const dir of dirs) {
    const p = resolveInstructionFile(dir)
    if (!p) continue
    const f = readInstructionFile(p)
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
    visited.add(dir)
    const p = resolveInstructionFile(dir)
    if (p) {
      const f = readInstructionFile(p, SUBDIR_FILE_CAP_CHARS)
      if (f && !hasInjectionRisk(f.content)) out.push(f)
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return out
}
