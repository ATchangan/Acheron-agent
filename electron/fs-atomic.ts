// electron/fs-atomic.ts — 原子写文件工具(v0.3.3 存储加固, v0.4.5 修正原子性)
// 临时文件 → fsync → rename 覆盖: rename 在同一卷上是原子操作, 崩溃/断电只会留下
// 要么旧文件要么新文件, 不会出现半写 JSON(会话/设置/记忆全量换用)。
// 注: Node 在 Windows 上经 MoveFileExW(MOVEFILE_REPLACE_EXISTING) 可直接覆盖已存在文件;
// 旧实现用 copyFile 覆盖 —— copy 是先截断再写, 中途崩溃恰好留下半截文件, 已弃用。
import * as fs from 'fs'
import { promises as fsp } from 'fs'
import { dirname } from 'path'

// 写满 content 后刷盘(rename 只保证文件系统元数据原子, 数据落盘靠 fsync)
function forceSyncSync(fd: number): void {
  try { fs.fsyncSync(fd) } catch { /* 部分文件系统(如网络盘)不支持, 忽略 */ }
}

export function writeFileAtomic(file: string, content: string): void {
  const dir = dirname(file)
  try { fs.mkdirSync(dir, { recursive: true }) } catch { /* 目录已存在或只读 */ }
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeFileSync(fd, content, 'utf-8')
    forceSyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    // 极少数场景 rename 失败(目标被占用/跨卷): 回退为 copy, 至少保证写入成功
    try { fs.copyFileSync(tmp, file) } catch { /* 保留原错误 */ }
    try { fs.rmSync(tmp, { force: true }) } catch { /* 忽略 */ }
    throw e
  }
}

// 内容未变化时不写: 抑制自写触发的 watcher/热重载环路
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
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(content, 'utf-8')
    try { await fh.sync() } catch { /* 部分文件系统不支持, 忽略 */ }
  } finally {
    await fh.close()
  }
  try {
    await fsp.rename(tmp, file)
  } catch (e) {
    try { await fsp.copyFile(tmp, file) } catch { /* 保留原错误 */ }
    try { await fsp.rm(tmp, { force: true }) } catch { /* 忽略 */ }
    throw e
  }
}
