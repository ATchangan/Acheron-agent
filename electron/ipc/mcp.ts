// electron/ipc/mcp.ts —— MCP 域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain, dialog } from 'electron'
import * as fs from 'fs'
import { readMcpConfig, markMcpManualDisconnect, stdioReconnectHandler } from '../mcp/auto'

export function registerMcpIpc(deps: { settingsPath: string }): void {
  const { settingsPath } = deps
  ipcMain.handle('mcp:connect', async (_e, name, cmd, args) => {
    // v0.4.x: 设置里的「启动等待时间」(mcpTimeout, 秒) 真正生效, 不再只是摆设
    let timeoutMs = 15000
    try {
      const raw = Number(JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))?.general?.mcpTimeout)
      if (Number.isFinite(raw) && raw > 0) timeoutMs = Math.min(Math.max(raw, 2), 120) * 1000
    } catch { /* 设置缺失时用默认 */ }
    const onExit = readMcpConfig(settingsPath).autoReconnect ? stdioReconnectHandler(settingsPath) : undefined
    try { return await require('../mcp/client').connectServer(name, cmd, args || [], timeoutMs, onExit) } catch (e: unknown) { return { error: (e instanceof Error ? e.message : String(e)) } }
  })
  ipcMain.handle('mcp:call', async (_e, server, tool, a) => {
    try { return await require('../mcp/client').callMCPTool(server, tool, a) } catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  ipcMain.handle('mcp:list', () => { try { return require('../mcp/client').listServers() } catch { return [] } })
  ipcMain.handle('mcp:disconnect', (_e, name: string) => {
    markMcpManualDisconnect(String(name || ''))
    const stdioOk = (() => { try { return require('../mcp/client').disconnectServer(String(name || '')) } catch { return false } })()
    const sseOk = (() => { try { return require('../mcp/sse-transport').disconnectSSE(String(name || '')) } catch { return false } })()
    return stdioOk || sseOk
  })
  ipcMain.handle('mcp:sse:connect', async (_e, name: string, url: string, headers?: Record<string, string>) => {
    try { const tools = await require('../mcp/sse-transport').connectSSE({ name, type: 'sse', url, headers }); return tools }
    catch (e: unknown) { return { error: (e instanceof Error ? e.message : String(e)) } }
  })
  ipcMain.handle('mcp:sse:call', async (_e, server: string, tool: string, args: Record<string, unknown>) => {
    try { return await require('../mcp/sse-transport').callSSETool(server, tool, args) }
    catch (e: unknown) { return 'Error: ' + (e instanceof Error ? e.message : String(e)) }
  })
  ipcMain.handle('mcp:sse:list', () => { try { return require('../mcp/sse-transport').listSSEServers() } catch { return [] } })
  // 工具调用审批 —— 渲染层权限为 ask 时, 主进程弹原生确认框
  ipcMain.handle('mcp:confirm', async (_e, info: { server?: string; tool?: string; args?: Record<string, unknown> }) => {
    try {
      const detail = JSON.stringify(info?.args || {}).slice(0, 800)
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['拒绝', '允许'],
        defaultId: 1,
        cancelId: 0,
        title: 'MCP 工具调用确认',
        message: '是否允许调用 MCP 工具？',
        detail: (info?.server || '') + '/' + (info?.tool || '') + (detail && detail !== '{}' ? '\n\n参数：' + detail : ''),
      })
      return response === 1
    } catch { return false }
  })
}
