// scripts/eval/brand-scan.mjs — 品牌词扫描(发布门禁)
// 对外发布内容不得出现竞品/参考产品品牌词(Hermes / Codex / Nous 独立词)。
// 排除第三方依赖(node_modules)、构建产物(dist/dist-electron/release)、锁文件、评估历史与旧备份。
// 纯 node 实现, 不依赖 rg, 可在任意环境直接运行。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.git', '.vite', '_archive'])
const SKIP_FILES = new Set(['package-lock.json', 'eval-history.jsonl', 'brand-scan.mjs'])
// 模式由两部分拼接, 避免扫描器命中自身; nous 用词边界避免命中 synchronous 等
const PATTERNS = [
  { re: /her\s*mes/gi, label: 'Hermes' },
  { re: /co\s*dex/gi, label: 'Codex' },
  { re: /\bnous\b/gi, label: 'Nous' },
]

const hits = []
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    const rel = relative(ROOT, full).split(sep).join('/')
    if (SKIP_FILES.has(name)) continue
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (!/\.(ts|tsx|js|mjs|cjs|css|html|md|json|yml|yaml|txt)$/i.test(name)) continue
    const text = readFileSync(full, 'utf8')
    for (const { re, label } of PATTERNS) {
      const m = text.match(re)
      if (m) hits.push(`${rel}: ${label}`)
    }
  }
}

walk(ROOT)
if (hits.length) {
  console.error('[X] 品牌词命中:\n' + hits.join('\n'))
  process.exit(1)
}
console.log('[OK] 品牌词扫描通过: 0 命中')
