// electron/ipc/models.ts —— 模型探测域 IPC(0.3.1 块 G 迁移, 行为零变化)
import { ipcMain } from 'electron'

export function registerModelsIpc(deps: {
  netFetch: typeof fetch
}): void {
  const { netFetch } = deps

  // 平台已知模型补充 —— 部分平台 /models 不返回全部可用模型(尤其视觉/多模态)：
  // always: 无论列表是否为空都补充(经实测该 key 可用); ifEmpty: 列表为空时才补充(如方舟未创建接入点时)
  const SUPPLEMENT_BY_HOST: Record<string, { always?: string[]; ifEmpty?: string[] }> = {
    'open.bigmodel.cn': {
      always: ['glm-4v-flash', 'glm-4v-plus', 'glm-4.5v', 'glm-4.6v', 'glm-4.6v-flash'],
    },
    'ark.cn-beijing.volces.com': {
      ifEmpty: [
        'doubao-seed-2-0-pro-260215',
        'doubao-seed-2-0-lite-260428',
        'doubao-seed-1-6-250615',
        'doubao-seed-1-6-flash-250615',
        'doubao-seed-1-6-thinking-250715',
        'doubao-seed-1-6-vision-250815',
        'doubao-1-5-pro-32k-250115',
        'doubao-1-5-vision-pro-32k-250115',
        'doubao-1-5-thinking-pro-250615',
        'doubao-1-5-thinking-vision-pro-250615',
      ],
    },
  }

  ipcMain.handle('models:detect', async (_e, baseUrl: string, apiKey: string, opts?: { anthropic?: boolean; type?: string }) => {
    try {
      let base = (baseUrl || '').replace(/\/+$/, '')
      if (!base) return { ok: false, error: '请先填写 Base URL' }
      // Anthropic(Claude) 鉴权是 x-api-key 而非 Bearer —— 按 baseUrl / key 前缀自动识别
      // 支持 Azure OpenAI / Google Gemini 模型列表接口
      const isAnthropic = !!(opts?.type === 'Anthropic Claude' || opts?.anthropic || /anthropic/i.test(base) || (apiKey || '').startsWith('sk-ant-'))
      const isAzure = !!opts?.type?.includes('Azure') || /openai\.azure\.com/i.test(base)
      const isGemini = !!opts?.type?.includes('Gemini') || /generativelanguage\.googleapis\.com/i.test(base)
      // 分页拉取全部模型 —— OpenAI 兼容接口用 after/last_id，Gemini 用 pageToken
      const allIds = new Set<string>()
      let page = 0
      let cursor: string | null = null
      const seenCursors = new Set<string>()
      while (page < 50) {
        let url: string
        const headers: Record<string, string> = {}
        if (isAnthropic) {
          url = base.replace(/\/v\d+$/i, '') + '/v1/models'
          headers['x-api-key'] = apiKey || ''
          headers['anthropic-version'] = '2023-06-01'
        } else if (isAzure) {
          const root = base.replace(/\/openai\/?.*$/i, '')
          url = root + '/openai/models?api-version=2024-06-01'
          headers['api-key'] = apiKey || ''
        } else if (isGemini) {
          url = base.replace(/\/v\d+(beta)?\/?$/i, '') + '/v1beta/models?key=' + encodeURIComponent(apiKey || '')
          if (cursor) url += '&pageToken=' + encodeURIComponent(cursor)
        } else {
          url = /\/v\d+$/i.test(base) ? base + '/models' : base + '/v1/models'
          if (cursor) url += (url.includes('?') ? '&' : '?') + 'after=' + encodeURIComponent(cursor)
          headers['Authorization'] = 'Bearer ' + (apiKey || '')
        }
        const res = await netFetch(url, { headers, signal: AbortSignal.timeout(15000) })
        if (!res.ok) {
          const hint = res.status === 401 ? 'API Key 无效或未授权'
            : res.status === 403 ? '禁止访问（Key 无权限或地区限制）'
            : res.status === 404 ? '接口路径不存在，请检查 Base URL'
            : res.status === 410 ? '接口已废弃，请更新 Base URL'
            : ''
          return { ok: false, error: 'HTTP ' + res.status + (hint ? '：' + hint : '') }
        }
        const data = JSON.parse(await res.text())
        // 兼容多种返回结构：OpenAI 用 data[]，Gemini 用 models[]，部分网关用 list/items/result[]
        const rawArr = isGemini
          ? (data.models || [])
          : (data.data || data.models || data.list || data.items || data.result || [])
        const pageIds = rawArr
          .map((m: { id?: string; name?: string }) => String(m.id || m.name || '').replace(/^models\//, ''))
          .filter(Boolean)
        for (const id of pageIds) allIds.add(id)
        // 确定是否还有下一页：优先 OpenAI 风格，其次 Gemini 风格
        let next: string | null = null
        const hasMore = data.has_more === true || data.has_more === 1 || String(data.has_more).toLowerCase() === 'true'
        if (hasMore && data.last_id) next = String(data.last_id)
        else if (data.nextPageToken || data.next_page_token) next = String(data.nextPageToken || data.next_page_token)
        if (!next || seenCursors.has(next)) break
        seenCursors.add(next)
        cursor = next
        page++
      }
      const filtered = [...allIds].filter((id: string) => !id.includes('embedding') && !id.includes('rerank'))
      // 按平台补充列表接口未返回的已知模型
      let host = ''
      try { host = new URL(base).hostname } catch { /* 非 URL 时跳过补充 */ }
      const sup = SUPPLEMENT_BY_HOST[host]
      if (sup) {
        const extras = (sup.always || []).concat(filtered.length === 0 ? (sup.ifEmpty || []) : [])
        for (const id of extras) if (!filtered.includes(id)) filtered.push(id)
      }
      return { ok: true, models: filtered }
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e))
      const hint = /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(msg) ? '域名无法解析，请检查 Base URL 是否填写正确'
        : /timeout|abort/i.test(msg) ? '请求超时（网络不通或需要代理）'
        : /ECONNREFUSED/i.test(msg) ? '连接被拒绝（地址或端口错误）'
        : /fetch failed/i.test(msg) ? '网络请求失败'
        : ''
      return { ok: false, error: (hint || msg).slice(0, 200) }
    }
  })

  // 测试连接 —— 轻量探测 baseUrl + apiKey 是否可用（不拉全量模型）
  ipcMain.handle('models:test', async (_e, baseUrl: string, apiKey: string, opts?: { anthropic?: boolean }) => {
    const t0 = Date.now()
    try {
      let base = (baseUrl || '').replace(/\/+$/, '')
      if (!base) return { ok: false, status: 0, latency: 0, message: '请先填写 Base URL' }
      const isAnthropic = !!(opts?.anthropic || /anthropic/i.test(base) || (apiKey || '').startsWith('sk-ant-'))
      let url: string
      const headers: Record<string, string> = {}
      if (isAnthropic) {
        url = base.replace(/\/v\d+$/i, '') + '/v1/models'
        headers['x-api-key'] = apiKey || ''
        headers['anthropic-version'] = '2023-06-01'
      } else {
        url = /\/v\d+$/i.test(base) ? base + '/models' : base + '/v1/models'
        headers['Authorization'] = 'Bearer ' + (apiKey || '')
      }
      const res = await netFetch(url, { headers, signal: AbortSignal.timeout(10000) })
      const latency = Date.now() - t0
      if (res.status === 200) {
        return { ok: true, status: 200, latency, message: '连接成功，API Key 有效' }
      }
      if (res.status === 401) return { ok: false, status: 401, latency, message: '已连接，但 API Key 无效或未授权 (401)' }
      if (res.status === 403) return { ok: false, status: 403, latency, message: '已连接，但无权限 (403)，请检查 Key 或地区限制' }
      if (res.status === 404 || res.status === 410) return { ok: false, status: res.status, latency, message: '服务器可达，但该接口不存在 (' + res.status + ')，此平台可能不支持模型列表接口' }
      return { ok: false, status: res.status, latency, message: '服务器响应异常 (HTTP ' + res.status + ')' }
    } catch (e: unknown) {
      const latency = Date.now() - t0
      const msg = (e instanceof Error ? e.message : String(e))
      const hint = /getaddrinfo|ENOTFOUND|EAI_AGAIN/i.test(msg) ? '域名无法解析，请检查 Base URL 是否填写正确'
        : /timeout|abort/i.test(msg) ? '连接超时（网络不通或需要代理）'
        : /ECONNREFUSED/i.test(msg) ? '连接被拒绝（地址或端口错误）'
        : /fetch failed/i.test(msg) ? '网络请求失败'
        : msg.slice(0, 120)
      return { ok: false, status: 0, latency, message: hint }
    }
  })
}
