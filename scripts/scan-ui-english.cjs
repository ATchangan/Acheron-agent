// 扫描组件中所有含英文的用户可见文案(placeholder/title/label/hint/按钮/文本)
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..', 'src', 'components')

const files = []
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.tsx')) files.push(p) } }
walk(root)

const results = []
for (const f of files) {
  const c = fs.readFileSync(f, 'utf-8')
  // 提取所有字符串字面量(双引号内, 排除 import/代码行)
  for (const m of c.matchAll(/(placeholder|title|label|hint|alt|aria-label)="([^"]*)"/g)) {
    if (/[A-Za-z]/.test(m[2])) results.push({ f: path.relative(root, f), kind: m[1], text: m[2] })
  }
  // JSX 文本节点(>文字<)
  for (const m of c.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)<\//g)) {
    const t = m[1].trim()
    if (t && /[A-Za-z]/.test(t)) results.push({ f: path.relative(root, f), kind: 'text', text: t })
  }
  // '单引号'字符串在 JS 里(title 等变量)
  for (const m of c.matchAll(/(placeholder|title|label|hint)=[']([^']*)[']/g)) {
    if (/[A-Za-z]/.test(m[2])) results.push({ f: path.relative(root, f), kind: m[1], text: m[2] })
  }
}

const byFile = {}
for (const r of results) { (byFile[r.f] = byFile[r.f] || []).push(r) }
for (const [f, arr] of Object.entries(byFile)) {
  console.log('=== ' + f + ' (' + arr.length + ') ===')
  for (const r of arr.slice(0, 30)) console.log('  [' + r.kind + '] ' + r.text)
}
console.log('TOTAL:', results.length)
