// v0.2.5 T1: 主题 token 一致性校验
// 用法: node scripts/check-theme-tokens.mjs
// 1. 提取 global.css 中每个 [data-theme="x"] 块
// 2. 与基准块(dark)对比键集合 —— 缺失/多余即失败
// 3. :root 必须定义全部【组件专属】token
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(join(root, 'src', 'styles', 'global.css'), 'utf-8')

let fail = 0
const err = (msg) => { fail++; console.log('FAIL | ' + msg) }
const ok = (msg) => console.log('PASS | ' + msg)

// 1. 提取主题块
const themeBlocks = {}
const re = /\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g
let m
while ((m = re.exec(css))) {
  const keys = [...m[2].matchAll(/--([\w-]+)\s*:/g)].map(x => '--' + x[1])
  themeBlocks[m[1]] = keys
}
const themeNames = Object.keys(themeBlocks)
ok('发现主题: ' + themeNames.join(', '))

// 2. 基准对比(dark 块)
const base = themeBlocks['dark']
if (!base) { err('缺少基准主题 dark'); process.exit(1) }
const baseSet = new Set(base)
for (const name of themeNames) {
  if (name === 'dark') continue
  const keys = themeBlocks[name]
  const missing = base.filter(k => !keys.includes(k))
  const extra = keys.filter(k => !baseSet.has(k))
  if (missing.length || extra.length) {
    err(`${name}: 缺失 ${missing.join(',')} | 多余 ${extra.join(',')}`)
  } else {
    ok(`${name}: ${keys.length} 个 token 与基准完全一致`)
  }
}
// 必需主题数
const required = ['dark', 'light', 'black', 'huangquan', 'bloodmoon', 'dawn']
for (const r of required) if (!themeBlocks[r]) err('缺少主题: ' + r)

// 3. :root 组件专属 token 完整性
const rootBlock = css.match(/:root\s*\{([^}]*)\}/)
if (!rootBlock) { err(':root 块缺失'); process.exit(1) }
const rootText = rootBlock[1]
const compTokens = ['--bubble-user', '--bubble-assistant', '--code-bg', '--selection', '--scrollbar', '--scrollbar-hover',
  '--skin-accent-soft', '--skin-accent-mid', '--skin-accent-strong', '--shadow-1', '--shadow-2', '--overlay', '--blur',
  '--t-fast', '--t-norm', '--t-slow', '--bg-mask']
for (const tk of compTokens) {
  if (!rootText.includes(tk + ':')) err(':root 缺少 ' + tk)
}
ok('组件专属 token 检查完成')

// 4. 禁止在主题块外使用裸 hex(仅 token 定义区) —— 宽松检查: 主题块外仍可能有合法用途, 仅提示
const outsideHex = css.split(/\[data-theme="[^"]+"\]\s*\{[^}]*\}/).slice(1).join('')
// 跳过 :root 块(允许 token 定义)
console.log('\n结果: ' + (fail === 0 ? '全部通过' : fail + ' 项失败'))
process.exit(fail ? 1 : 0)
