// v0.3.4 T2: system prompt 前缀稳定性断言(供应商上下文缓存友好度)
// 用法: node scripts/check-prefix-stable.mjs [snapshot.json]
// 快照格式: {"capturedAt": "...", "snapshots": ["<sp1>", "<sp2>", ...]}
// 采集方式: 应用侧连续 5 次请求把 __lastSp 写入该 JSON(或手动导出)
// 断言: 去除动态段(记忆/归档/workflows/时间戳/前文摘要)后, 所有快照前缀一致
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const file = process.argv[2] || join(__dirname, '..', 'docs', 'sp-prefix-snapshots.json')

if (!existsSync(file)) {
  console.log('SKIP | 快照文件不存在: ' + file)
  console.log('      先采集: 连续 5 次同会话请求, 导出 __lastSp 到该 JSON')
  process.exit(0)
}

let data
try {
  data = JSON.parse(readFileSync(file, 'utf-8'))
} catch (e) {
  console.error('FAIL | 快照解析失败:', e.message)
  process.exit(1)
}

const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : []
if (snapshots.length < 2) {
  console.log('SKIP | 快照不足 2 条(当前 ' + snapshots.length + ' 条)')
  process.exit(0)
}

// 动态段标题: 记忆/归档/workflows 按需块/时间戳
const DYNAMIC_HEAD = /^## (任务归档|置顶记忆|长期记忆|近期情景摘要|工作流|当前时间)/
function stripDynamic(sp) {
  const lines = String(sp || '').split('\n')
  const keep = []
  let inDynamic = false
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('[前文摘要]')) { inDynamic = true; continue }
    if (t.startsWith('## ')) {
      inDynamic = DYNAMIC_HEAD.test(t)
      if (inDynamic) continue
    } else if (inDynamic && t.startsWith('## ')) {
      inDynamic = false
    } else if (inDynamic) {
      continue // 动态块内容行
    }
    keep.push(line)
  }
  return keep.join('\n')
}

const prefixes = snapshots.map(stripDynamic)
const first = prefixes[0]
let unstableAt = -1
for (let i = 1; i < prefixes.length; i++) {
  if (prefixes[i] !== first) { unstableAt = i; break }
}

if (unstableAt < 0) {
  console.log('PASS | 前缀稳定 (' + snapshots.length + ' 次快照, 去除动态段后一致)')
  process.exit(0)
}

// 定位首次差异位置
let diffPos = 0
const a = first, b = prefixes[unstableAt]
while (diffPos < a.length && diffPos < b.length && a[diffPos] === b[diffPos]) diffPos++
console.log('FAIL | 快照 #' + (unstableAt + 1) + ' 前缀不稳定, 首次差异位于字符 ' + diffPos)
console.log('      期望: ...' + a.slice(Math.max(0, diffPos - 40), diffPos + 40).replace(/\n/g, '\\n'))
console.log('      实际: ...' + b.slice(Math.max(0, diffPos - 40), diffPos + 40).replace(/\n/g, '\\n'))
console.log('      说明: 动态内容(记忆/归档/时间戳)只允许出现在 system 尾部; Agent 切换(handoff)后首请求缓存失效属正常')
process.exit(1)
