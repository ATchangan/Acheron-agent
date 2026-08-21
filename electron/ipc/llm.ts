// electron/ipc/llm.ts — LLM 域 IPC(v0.3.3 独立内核: 薄包装, 逻辑在 engine/llm-core)
import { ipcMain } from 'electron'
import { streamChat, chatOnce, visionOnce, abortLLM } from '../engine/llm-core'
import type { LlmChatParams } from '../engine/llm-core'

export function registerLlmIpc(deps: { netFetch: typeof fetch }): void {
  const { netFetch } = deps

  ipcMain.handle('llm:abort', (_e, id?: string) => {
    abortLLM(id)
  })

  ipcMain.handle('llm:chat', async (event, params: LlmChatParams) => {
    await streamChat(netFetch, params, {
      onChunk: d => event.sender.send('llm:chunk', d),
      onToolCall: tc => event.sender.send('llm:toolCall', tc),
      onUsage: u => event.sender.send('llm:usage', u),
      onError: e => event.sender.send('llm:error', e),
    })
  })

  ipcMain.handle('llm:chatOnce', async (_e, params: LlmChatParams) => {
    return chatOnce(netFetch, params)
  })

  ipcMain.handle('llm:vision', async (_e, params: { provider: string; model: string; apiKey?: string; baseUrl?: string; imageDataUrl: string; prompt?: string; customHeaders?: string }) => {
    return visionOnce(netFetch, params)
  })
}
