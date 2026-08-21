// electron/engine/cache-caps.ts —— 供应商缓存统计能力判定
// 依据官方文档/API 参考逐一核实（v0.3.6）：
//   supported   : 官方 usage 返回缓存命中/写入字段
//   unsupported : 官方 chat/completions usage 不返回缓存字段（如本地 LM Studio/Ollama）
//   unknown     : 官方文档无缓存字段说明；界面/持久化按不支持处理，
//                 但运行中若真实响应出现缓存字段，自动升级为 supported
export type CacheCap = 'supported' | 'unsupported' | 'unknown'

// 判定结果 → 持久化布尔值：未确认与不支持一律按 false（界面显示"不支持"）
export function cacheCapToSupported(cap: CacheCap): boolean {
  return cap === 'supported'
}

// 预设供应商名（与设置页 PRESETS 一一对应）
const PRESET_CAPS: Record<string, CacheCap> = {
  'DeepSeek': 'supported',
  'OpenAI': 'supported',
  '通义千问': 'supported',
  '智谱': 'supported',
  'Kimi': 'supported',
  'Claude': 'supported',
  'Gemini': 'supported',
  'SiliconFlow': 'supported',
  '豆包(火山方舟)': 'supported',
  'MiniMax': 'supported',
  'OpenRouter': 'supported',
  'Groq': 'supported',
  'Mistral': 'supported',
  'xAI Grok': 'supported',
  // Together 官方 API 参考 usage 仅列 prompt/completion/total_tokens，无缓存字段
  'Together': 'unknown',
  // 本地/无缓存响应供应商
  'LM Studio': 'unsupported',
  'Ollama': 'unsupported',
  'Perplexity': 'unsupported',
  '讯飞星火': 'unsupported',
  'NVIDIA NIM': 'unsupported',
  '即梦Jimeng': 'unsupported',
  // 未能从官方文档确认缓存字段
  '零一万物': 'unknown',
  'Agnes': 'unknown',
  '文心一言': 'unknown',
  '百川': 'unknown',
}

const TYPE_CAPS: Record<string, CacheCap> = {
  'Anthropic Claude': 'supported',
  'Google Gemini': 'supported',
  'Azure OpenAI': 'supported',
}

const UNSUPPORTED_URL_MARKS = [
  'spark-api-open.xf-yun.com', // 讯飞星火
  '127.0.0.1:11434', 'localhost:11434', // Ollama
  '127.0.0.1:1234', 'localhost:1234', 'lmstudio', // LM Studio
  'lingyiwanwu', // 零一万物
  'integrate.api.nvidia.com', // NVIDIA NIM
  'perplexity.ai', // Perplexity
]

const SUPPORTED_URL_MARKS = [
  'api.deepseek.com', // DeepSeek
  'openai.com', // OpenAI / Azure 网关
  'dashscope.aliyuncs.com', // 通义千问/百炼
  'open.bigmodel.cn', // 智谱
  'api.moonshot.cn', // Kimi
  'anthropic.com', // Claude
  'generativelanguage.googleapis.com', // Gemini
  'api.siliconflow.cn', // SiliconFlow
  'ark.cn-beijing.volces.com', // 火山方舟/豆包
  'api.minimax.chat', // MiniMax
  'openrouter.ai', // OpenRouter
  'api.groq.com', // Groq
  'api.mistral.ai', // Mistral
  'api.x.ai', // xAI Grok
  'api.together.xyz', // Together（未确认，仅 URL 识别）
]

export function classifyCacheSupport(
  p: { name?: string; type?: string; baseUrl?: string },
  sawCacheFields?: boolean,
): CacheCap {
  const name = (p?.name || '').trim()
  const type = (p?.type || '').trim()
  const base = (p?.baseUrl || '').toLowerCase()

  // 1) 预设供应商名最优先（即梦与豆包共用火山 URL，必须靠名字区分）
  if (name && PRESET_CAPS[name] !== undefined) {
    const cap = PRESET_CAPS[name]
    // unknown 预设（如 Together）允许被运行期真实缓存字段升级为 supported
    if (cap !== 'unknown' || !sawCacheFields) return cap
  }
  // 2) API 类型
  if (type && TYPE_CAPS[type] !== undefined) return TYPE_CAPS[type]
  // 3) BaseURL 特征
  if (base) {
    for (const mark of UNSUPPORTED_URL_MARKS) if (base.includes(mark)) return 'unsupported'
    for (const mark of SUPPORTED_URL_MARKS) if (base.includes(mark)) return 'supported'
  }
  // 4) 运行期真实响应里出现过缓存字段 → 按支持处理
  if (sawCacheFields) return 'supported'
  return 'unknown'
}
