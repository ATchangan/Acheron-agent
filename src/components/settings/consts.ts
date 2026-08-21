// src/components/settings/consts.ts —— 供应商/媒体常量(v0.3.1 C2: 从 ModelsTab 拆出)
export const AI_TYPES = ['OpenAI Compatible', 'Azure OpenAI', 'Anthropic Claude', 'Google Gemini']
export const PRESETS: Record<string, { type: string; url: string; noKey?: boolean }> = {
  'DeepSeek': { type: 'OpenAI Compatible', url: 'https://api.deepseek.com' },
  'OpenAI': { type: 'OpenAI Compatible', url: 'https://api.openai.com/v1' },
  '通义千问': { type: 'OpenAI Compatible', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  '智谱': { type: 'OpenAI Compatible', url: 'https://open.bigmodel.cn/api/paas/v4' },
  'Kimi': { type: 'OpenAI Compatible', url: 'https://api.moonshot.cn/v1' },
  'Claude': { type: 'Anthropic Claude', url: 'https://api.anthropic.com' },
  'Gemini': { type: 'Google Gemini', url: 'https://generativelanguage.googleapis.com' },
  'SiliconFlow': { type: 'OpenAI Compatible', url: 'https://api.siliconflow.cn/v1' },
  'Ollama': { type: 'OpenAI Compatible', url: 'http://127.0.0.1:11434/v1', noKey: true },
  'LM Studio': { type: 'OpenAI Compatible', url: 'http://127.0.0.1:1234/v1', noKey: true },
  '豆包(火山方舟)': { type: 'OpenAI Compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
  'MiniMax': { type: 'OpenAI Compatible', url: 'https://api.minimax.chat/v1' },
  '文心一言': { type: 'OpenAI Compatible', url: 'https://qianfan.baidubce.com/v2' },
  '讯飞星火': { type: 'OpenAI Compatible', url: 'https://spark-api-open.xf-yun.com/v1' },
  '百川': { type: 'OpenAI Compatible', url: 'https://api.baichuan-ai.com/v1' },
  '零一万物': { type: 'OpenAI Compatible', url: 'https://api.lingyiwanwu.com/v1' },
  'OpenRouter': { type: 'OpenAI Compatible', url: 'https://openrouter.ai/api/v1' },
  'Groq': { type: 'OpenAI Compatible', url: 'https://api.groq.com/openai/v1' },
  'Mistral': { type: 'OpenAI Compatible', url: 'https://api.mistral.ai/v1' },
  'xAI Grok': { type: 'OpenAI Compatible', url: 'https://api.x.ai/v1' },
  'Perplexity': { type: 'OpenAI Compatible', url: 'https://api.perplexity.ai' },
  'Together': { type: 'OpenAI Compatible', url: 'https://api.together.xyz/v1' },
  'NVIDIA NIM': { type: 'OpenAI Compatible', url: 'https://integrate.api.nvidia.com/v1' },
  'Agnes': { type: 'OpenAI Compatible', url: 'https://apihub.agnes-ai.com/v1' },
  '即梦Jimeng': { type: 'OpenAI Compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
}
export const GROUPS: Record<string, string[]> = {
  文字: ['DeepSeek', 'OpenAI', '通义千问', '智谱', 'Kimi', 'Claude', 'Gemini', 'SiliconFlow', 'Ollama', 'LM Studio', '豆包(火山方舟)', 'MiniMax', '文心一言', '讯飞星火', '百川', '零一万物', 'OpenRouter', 'Groq', 'Mistral', 'xAI Grok', 'Perplexity', 'Together', 'NVIDIA NIM'],
  图片: ['Agnes', '即梦Jimeng'],
  视频: ['即梦Jimeng'],
}
export const MEDIA_PRESETS: Record<string, { type: string; url: string; noKey?: boolean }> = {
  'Agnes': { type: 'OpenAI Compatible', url: 'https://apihub.agnes-ai.com/v1' },
  '即梦Jimeng': { type: 'OpenAI Compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
  '可灵Kling': { type: 'OpenAI Compatible', url: 'https://api.klingai.com' },
  'Runway': { type: 'OpenAI Compatible', url: 'https://api.runwayml.com/v1' },
  'Pika': { type: 'OpenAI Compatible', url: 'https://api.pika.art/v1' },
  'Suno': { type: 'OpenAI Compatible', url: 'https://api.suno.ai/v1' },
  'Whisper本地': { type: 'OpenAI Compatible', url: 'http://127.0.0.1:1234/v1', noKey: true },
  'ChatTTS本地': { type: 'OpenAI Compatible', url: 'http://127.0.0.1:9880/v1' },
  '豆包(火山方舟)': { type: 'OpenAI Compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
}
export const CAP_COLORS: Record<string, string> = { '多模态': '#a78bfa', '文字': '#60a5fa', '图片': '#34d399', '视频': '#fbbf24', '语音': '#f472b6' }
export const detectCaps = (models: string[]): string[] => {
  const caps = new Set<string>()
  for (const m of models || []) {
    const ml = String(m).toLowerCase()
    // 多模态：能理解图像/视频的对话模型
    if (/(gpt-4o|gpt-4\.1|gpt-4-turbo|claude|gemini|vision|\bvlm?\b|4v|\d+v|omni|qwen-vl|qwen2-vl|qwen2\.5-vl|qwen3-vl|glm-4v|glm-5v|llava|yi-vision|internvl|minicpm-v|moondream|pixtral|phi-vision|llama-3\.2-vision|deepseek-vl|step-1v|hunyuan-vision|doubao.*vision|kimi-vl|spark.*vision|ocr|识图|多模态|multimodal)/.test(ml)) caps.add('多模态')
    // 图片生成
    if (/(image|img|flux|dall|sdxl|stable-diffusion|seedream|cogview|wanx|kolors|ernie-vilg|midjourney|draw|文生图|图生图|text2img|t2i|image-gen|imagegen|photogen|qwen-image|hunyuan-image|recraft|ideogram|fooocus|comfyui|imagen)/.test(ml)) caps.add('图片')
    // 视频生成
    if (/(video|vid|sora|kling|runway|pika|veo|seedance|gen-?[345]|keling|lumina|cosmos|hunyuan-video|qwen-video|t2v|i2v|text2video|文生视频|图生视频)/.test(ml)) caps.add('视频')
    // 语音/音频
    if (/(asr|tts|whisper|voice|speech|audio|transcribe|chattts|cosyvoice|funasr|sensevoice|spark-tts|doubao-tts|minimax-speech|qwen-audio|语音|音频|朗读)/.test(ml)) caps.add('语音')
  }
  if (!caps.size) caps.add('文字')
  return [...caps]
}
