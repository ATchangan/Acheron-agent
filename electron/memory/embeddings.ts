// electron/memory/embeddings.ts — 语义向量嵌入(OpenAI 兼容 /embeddings 接口)
// 从旧 vector.ts 抽出: 单条 + 批量两种调用, 供 SQLite 记忆落库与检索共用
export interface EmbeddingCfg { baseUrl: string; apiKey: string; model: string }

let cfg: EmbeddingCfg | null = null

export function setEmbeddingConfig(next: EmbeddingCfg | null): void {
  cfg = next && next.baseUrl && next.model ? { baseUrl: next.baseUrl, apiKey: next.apiKey || '', model: next.model } : null
}

export function getEmbeddingConfig(): EmbeddingCfg | null {
  return cfg ? { ...cfg } : null
}

function embeddingsUrl(base: string): string {
  const b = base.replace(/\/+$/, '')
  return /\/v\d+$/i.test(b) ? b + '/embeddings' : b + '/v1/embeddings'
}

export async function embedText(text: string): Promise<number[] | null> {
  const batch = await embedBatch([text])
  return batch[0] ?? null
}

// input 支持数组(单条也是数组, 避免两次请求); 失败条目返回 null, 保证索引与输入对齐
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!cfg || !texts.length) return texts.map(() => null)
  try {
    const net = require('electron').net as { fetch: typeof fetch }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey
    const res = await net.fetch(embeddingsUrl(cfg.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: cfg.model, input: texts.map(t => String(t || '').slice(0, 8000)) }),
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return texts.map(() => null)
    const data = (await res.json()) as { data?: { embedding?: number[]; index?: number }[] }
    const byIndex = new Map<number, number[]>()
    for (const item of data.data || []) {
      if (typeof item.index === 'number' && Array.isArray(item.embedding) && item.embedding.length) byIndex.set(item.index, item.embedding)
    }
    return texts.map((_, i) => byIndex.get(i) ?? null)
  } catch {
    return texts.map(() => null)
  }
}
