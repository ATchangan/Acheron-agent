// scripts/eval/brand-scan.mjs — 品牌词扫描(发布门禁)
// 对外发布内容不得出现竞品/参考产品品牌词; 扫描模式由两部分拼接, 避免扫描器命中自身。
// 排除第三方依赖(node_modules)、构建产物(dist/dist-electron/release)、锁文件与评估历史。
import { execSync } from 'node:child_process'

const EXCLUDES = [
  '!node_modules/**',
  '!dist/**',
  '!dist-electron/**',
  '!release/**',
  '!.git/**',
  '!package-lock.json',
  '!scripts/eval/eval-history.jsonl',
].map(g => '-g "' + g + '"').join(' ')

try {
  const pat = 'her' + 'mes|co' + 'dex'
  const out = execSync('rg -n -i --hidden ' + EXCLUDES + ' -e "' + pat + '" .', { encoding: 'utf8' }).trim()
  if (out) {
    console.error('[X] 品牌词命中:\n' + out)
    process.exit(1)
  }
} catch (e) {
  // rg 无匹配时退出码为 1, 这是期望结果
  if (e.status === 1 && !e.stdout) { console.log('[OK] 品牌词扫描通过: 0 命中'); process.exit(0) }
  console.error('[X] 品牌词扫描失败: ' + (e.message || String(e)))
  process.exit(1)
}

console.log('[OK] 品牌词扫描通过: 0 命中')
