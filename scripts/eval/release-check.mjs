// scripts/eval/release-check.mjs — 发布门禁(0.3.9 工程纪律)
// 检查: 版本一致性 / CHANGELOG 条目 / HEAD tag / 品牌词 / lint / typecheck / test / eval:unit
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'

let failed = false
const fail = (msg) => { console.error('[X] ' + msg); failed = true }

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const version = pkg.version
console.log('== 发布门禁 v' + version + ' ==')

// 1. HEAD tag 与版本一致
try {
  const tag = execSync('git describe --tags --exact-match HEAD', { encoding: 'utf8' }).trim()
  if (tag !== 'v' + version) fail('HEAD tag 是 ' + tag + '，与 package.json 版本 v' + version + ' 不一致')
  else console.log('[OK] tag ' + tag + ' 与版本一致')
} catch {
  fail('HEAD 没有精确 tag（发布前需先提交并打 v' + version + '）')
}

// 2. CHANGELOG 条目
if (!fs.readFileSync('CHANGELOG.md', 'utf8').includes('## v' + version)) fail('CHANGELOG.md 缺少 ## v' + version + ' 条目')
else console.log('[OK] CHANGELOG.md 含 v' + version + ' 条目')

// 3. 工作区状态(警告不阻断, 但发布说明会提示)
const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
if (status) console.log('[警告] 工作区非空: ' + status.split('\n').length + ' 个变更（发布前应已提交）')
else console.log('[OK] 工作区干净')

// 4. 质量门禁
for (const script of ['lint', 'typecheck', 'test', 'eval:unit', 'brand:scan']) {
  console.log('▶ npm run ' + script)
  try { execSync('npm run ' + script, { stdio: 'inherit', timeout: 900000 }) }
  catch { fail('npm run ' + script + ' 失败') }
}

if (failed) { console.error('\n== 发布门禁未通过 =='); process.exit(1) }
console.log('\n== 发布门禁全部通过, 可以打包发布 ==')
