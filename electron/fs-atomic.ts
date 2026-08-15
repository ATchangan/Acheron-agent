// electron/fs-atomic.ts — 原子写文件工具(v0.3.3 存储加固)
// Windows 上直接 rename 覆盖已存在文件会失败, 采用 临时文件 → copy 覆盖 → 删除临时 的近似原子写,
// 避免崩溃/断电产生半写 JSON(会话/设置/记忆全量换用)。
import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { dirname } from 'path'

export function writeFileAtomic(file: string, content: string): void {
  const dir = dirname(file)
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 目录已存在或只读 */ }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  fs.writeFileSync(tmp, content, 'utf-8')
  try {
    fs.copyFileSync(tmp, file)
    try { fs.unlinkSync(tmp) } catch { /* 清理失败忽略 */ }
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    throw e
  }
}

// 内容未变化时不写(与 deepseek-harness 的 write-path integrity 对齐): 抑制自写触发的 watcher/热重载环路
export function writeFileAtomicIfChanged(file: string, content: string): boolean {
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === content) return false
  } catch { /* 读取失败按需要写入处理 */ }
  writeFileAtomic(file, content)
  return true
}

export async function writeFileAtomicAsync(file: string, content: string): Promise<void> {
  // v0.3.3 性能优化: 异步原子写(大会话不再阻塞主进程事件循环)
  const dir = dirname(file)
  try { await fsp.mkdir(dir, { recursive: true }) } catch { /* 目录已存在或只读 */ }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  await fsp.writeFile(tmp, content, 'utf-8')
  try {
    await fsp.copyFile(tmp, file)
    try { await fsp.unlink(tmp) } catch { /* 清理失败忽略 */ }
  } catch (e) {
    try { await fsp.rm(tmp, { force: true }) } catch { /* 忽略 */ }
    throw e
  }
}
