// electron/plugins/plugin-runner.ts — utilityProcess 传输(父进程侧)
// 每次调用 fork 独立子进程: 挂死强杀、崩溃不影响主进程; fork 失败(如打包环境异常)由上层回落同进程 vm 兜底。
import { utilityProcess, type UtilityProcess } from 'electron'
import type { HostDone, HostInitPayload, HostRunOpts } from './host-core'

// Electron 43 utilityProcess 的 message 在父侧同样包成 MessageEvent({data, ports})
const unwrapMessage = (m: unknown): unknown => {
  if (m && typeof m === 'object' && 'data' in (m as object)) return (m as { data: unknown }).data
  return m
}

export function runPluginInUtility(
  childPath: string,
  payload: HostInitPayload,
  handleCall: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: HostRunOpts & { killTimeoutMs?: number } = {},
): Promise<HostDone> {
  const killTimeoutMs = Math.max(1000, Number(opts.killTimeoutMs) || 120000)
  return new Promise<HostDone>((resolve, reject) => {
    let child: UtilityProcess
    try {
      child = utilityProcess.fork(childPath, [], { serviceName: 'hq-plugin-host' })
    } catch (e: unknown) {
      reject(e instanceof Error ? e : new Error(String(e)))
      return
    }
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let spawnTimer: ReturnType<typeof setTimeout> | null = null
    const finish = (d: HostDone | null, err?: string): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (spawnTimer) clearTimeout(spawnTimer)
      try { child.kill() } catch { /* 已退出 */ }
      if (d) resolve(d)
      else reject(new Error(err || '插件宿主进程异常退出'))
    }
    timer = setTimeout(() => finish(null, 'E:PLUGIN_TIMEOUT(' + Math.round(killTimeoutMs / 1000) + 's)'), killTimeoutMs)
    // 启动看门狗: 5s 未 spawn 视为宿主启动失败, 让上层及时回落 vm 兜底(不占用 120s 总预算)
    spawnTimer = setTimeout(() => finish(null, '插件宿主进程启动超时(5s)'), 5000)
    child.on('spawn', () => { if (spawnTimer) { clearTimeout(spawnTimer); spawnTimer = null } })
    child.on('message', (msg: unknown) => {
      const m = unwrapMessage(msg) as { type?: string; id?: number; name?: string; args?: Record<string, unknown>; ok?: boolean; result?: string; error?: string; logs?: string[] }
      if (m?.type === 'call') {
        void handleCall(String(m.name || ''), m.args || {}).then(
          value => { if (!settled) child.postMessage({ type: 'result', id: m.id, value }) },
          e => { if (!settled) child.postMessage({ type: 'result', id: m.id, error: e instanceof Error ? e.message : String(e) }) },
        )
      } else if (m?.type === 'done') {
        finish({ type: 'done', ok: m.ok === true, result: m.result, error: m.error, logs: Array.isArray(m.logs) ? m.logs : [] })
      }
    })
    child.on('exit', (code: number) => {
      if (!settled) finish(null, '插件宿主进程异常退出(code=' + code + ')')
    })
    child.postMessage({ type: 'init', ...payload })
  })
}
