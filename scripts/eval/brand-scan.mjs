// scripts/eval/brand-scan.mjs — 品牌词扫描(发布门禁)
// 对外发布内容不得出现竞品/参考产品品牌词(Hermes / Codex / Nous 独立词)。
// 排除第三方依赖(node_modules)、内嵌第三方内核(vendor)、构建产物(dist/dist-electron/release)、锁文件、评估历史与旧备份。
// 纯 node 实现, 不依赖 rg, 可在任意环境直接运行。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', 'release', '.git', '.vite', '_archive'])
// vendor/memory-core/node_modules 是第三方依赖, 整体跳过; vendor 源码仍参与品牌扫描
const SKIP_SUBPATHS = ['vendor/memory-core/node_modules/']
const SKIP_FILES = new Set(['package-lock.json', 'eval-history.jsonl', 'brand-scan.mjs'])
// 用词边界精确匹配, 避免误命中 (如 further message / synchronous 等)
const PATTERNS = [
  { re: /hermes/gi, label: 'Hermes' },
  { re: /codex/gi, label: 'Codex' },
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
    if (SKIP_SUBPATHS.some(sp => rel.startsWith(sp))) continue
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
