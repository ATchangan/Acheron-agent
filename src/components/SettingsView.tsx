import React, { useState, useEffect, useRef } from 'react'
import { useSettingsStore } from '../store/settings'
import { DEFAULT_CHAT_PERSONA, DEFAULT_WORK_PERSONA } from '../store/settings'
import { updateContextLimit } from '../store/chat'

const PRESETS: Record<string, { type: string; url: string; noKey?: boolean }> = {
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
  // v0.2.1: 扩充云平台
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
  // v0.2.1: 多媒体生成平台（Agnes / 即梦等）
  'Agnes': { type: 'OpenAI Compatible', url: 'https://apihub.agnes-ai.com/v1' },
  '即梦Jimeng': { type: 'OpenAI Compatible', url: 'https://ark.cn-beijing.volces.com/api/v3' },
}
const AI_TYPES = ['OpenAI Compatible', 'Azure OpenAI', 'Anthropic Claude', 'Google Gemini']
const GROUPS: Record<string, string[]> = {
  '国内云平台': ['DeepSeek', '通义千问', '智谱', 'Kimi', '豆包(火山方舟)', 'MiniMax', '文心一言', '讯飞星火', '百川', '零一万物', 'SiliconFlow', '即梦Jimeng'],
  '国际平台': ['OpenAI', 'Claude', 'Gemini', 'OpenRouter', 'Groq', 'Mistral', 'xAI Grok', 'Perplexity', 'Together', 'NVIDIA NIM', 'Agnes'],
  // v0.2.2: 本地工具单独分组
  '本地服务': ['Ollama', 'LM Studio', '自定义'],
}
// v0.2.1: 多媒体供应商预设（图片生成/视频生成/语音识别）
const MEDIA_PRESETS: Record<string, { type: string; url: string; noKey?: boolean; img?: string[]; video?: string[]; audio?: string[] }> = {
  '即梦Jimeng': { type: 'multi', url: 'https://ark.cn-beijing.volces.com/api/v3', img: ['seedream-4.0', 'seedream-3.0', 'cogview-4'], video: ['seedance2.0', 'seedance2.0fast', 'doubao-seedance'] },
  'Agnes': { type: 'multi', url: 'https://apihub.agnes-ai.com/v1', img: ['agnes-image', 'agnes-flux'], video: ['agnes-video'], audio: ['agnes-asr'] },
  '可灵Kling': { type: 'multi', url: 'https://api.klingai.com/v1', img: ['kling-v1', 'kolors'], video: ['kling-v2', 'kling-v2.1'] },
  'Runway': { type: 'video', url: 'https://api.runwayml.com/v1', video: ['gen3a_turbo', 'gen4'] },
  'Pika': { type: 'video', url: 'https://api.pika.art/v1', video: ['pika-2.0', 'pika-1.5'] },
  'Midjourney': { type: 'image', url: 'https://api.midjourney.com/v1', img: ['mj-v7', 'mj-v6.1'] },
  'Stable Diffusion': { type: 'image', url: 'http://127.0.0.1:7860', noKey: true, img: ['sd-1.5', 'sd-xl', 'flux.1-dev'] },
  '通义万相': { type: 'multi', url: 'https://dashscope.aliyuncs.com/api/v1', img: ['wanx-v1', 'wanx2.1-t2i-turbo'], video: ['wanx2.1-t2v-turbo'] },
  '文心一格': { type: 'image', url: 'https://aip.baidubce.com', img: ['ernie-vilg-v3'] },
  '讯飞语音': { type: 'audio', url: 'https://iat-api.xfyun.cn', audio: ['iflytek-asr', 'iflytek-tts'] },
  'Whisper本地': { type: 'audio', url: 'http://127.0.0.1:9000', noKey: true, audio: ['whisper-large-v3'] },
}

// v0.2.2: 判断是否为本地服务（127.0.0.1 / localhost / noKey）
const isLocalMedia = (name: string): boolean => {
  const pre = MEDIA_PRESETS[name]
  if (!pre) return false
  return /127\.0\.0\.1|localhost/i.test(pre.url) || !!pre.noKey
}

const C = { bg: '#0D0D1A', card: '#15152A', input: '#0F0F22', border: '#2A2D48', text: '#E8E8F0', label: '#BBBBD0', muted: '#78789A', accent: '#7C5CBF', accentBg: 'rgba(124,92,191,0.08)', danger: '#E05562' }
const S = {
  card: { background: C.card, border: '1px solid ' + C.border, borderRadius: 10, padding: '20px 22px', marginBottom: 14 },
  section: { fontSize: 11, fontWeight: 700, color: C.accent, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid ' + C.border },
  inp: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, padding: '0 12px', width: '100%', boxSizing: 'border-box' as const, outline: 'none' },
  num: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, padding: '0 10px', width: 72, outline: 'none', textAlign: 'center' as const },
  sel: { height: 38, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, padding: '0 10px', outline: 'none', cursor: 'pointer' },
  btn: (v: string) => ({ height: 34, padding: '0 18px', borderRadius: 7, border: v === 'ghost' ? '1px solid ' + C.border : 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: v === 'primary' ? C.accent : v === 'danger' ? C.danger : C.input, color: '#fff', whiteSpace: 'nowrap' as const }),
  row: { marginBottom: 14 },
  label: { fontSize: 11, fontWeight: 600, color: C.label, marginBottom: 5 },
  hint: { fontSize: 10, color: C.muted, marginTop: 5, lineHeight: 1.5 },
}

// Toggle switch component (Hermes-style)
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }> = ({ checked, onChange, label, hint }) => (
  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '8px 0' }}>
    <div>
      <div style={{ fontSize: 12, color: C.text }}>{label}</div>
      {hint && <div style={S.hint}>{hint}</div>}
    </div>
    <div onClick={() => onChange(!checked)} style={{ width: 42, height: 24, borderRadius: 12, background: checked ? C.accent : C.border, cursor: 'pointer', position: 'relative', transition: 'all .15s', flexShrink: 0 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: checked ? 21 : 3, transition: 'all .15s' }} />
    </div>
  </div>
)

// Number input with label
const NumSetting: React.FC<{ label: string; hint: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void }> = ({ label, hint, value, min, max, unit, onChange }) => (
  <div style={{ ...S.row, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
    <div style={{ flex: 1 }}>
      <div style={S.label}>{label}</div>
      <div style={S.hint}>{hint}</div>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <input type="number" style={S.num} min={min} max={max} value={value} onChange={e => onChange(Math.max(min, Math.min(max, parseInt(e.target.value) || value)))} />
      <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{unit}</span>
    </div>
  </div>
)

export default function SettingsView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { providers, general, addProvider, removeProvider, updateProvider } = useSettingsStore()

  const [tab, setTab] = useState('models'); const [selIdx, setSelIdx] = useState(0); const [showNew, setShowNew] = useState(false)
  // v0.2.6: 模型缓存统计(持久化)
  // v0.2.3-fix(N25): 类型对齐 v4 数据模型
  interface ModelStatV4 { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number; observedReqs: number }
  const [modelStats, setModelStats] = useState<Record<string, ModelStatV4>>({})
  const [newName, setNewName] = useState(''); const [newKey, setNewKey] = useState(''); const [newUrl, setNewUrl] = useState(''); const [newType, setNewType] = useState('OpenAI Compatible')
  const [bgOp, setBgOp] = useState((general as any).bgOpacity ?? 0.7)
  const hasBg = !!(general as any).bgImage
  useEffect(() => { setBgOp((general as any).bgOpacity ?? 0.7) }, [(general as any)?.bgOpacity])
  const [memF, setMemF] = useState<string[]>([]); const [loading, setLoading] = useState(false)
  const [chatPersona, setChatPersona] = useState((general as any).chatPersona || '')
  const [workPersona, setWorkPersona] = useState((general as any).workPersona || '')
  // v0.2.1: 同步 store → state（预设切换/外部修改时 textarea 实时刷新）
  useEffect(() => {
    setChatPersona((general as any).chatPersona || '')
    setWorkPersona((general as any).workPersona || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(general as any)?.chatPersona, (general as any)?.workPersona])
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const [pluginUrl, setPluginUrl] = useState('')
  const [showPluginInput, setShowPluginInput] = useState(false)
  const [modelInput, setModelInput] = useState<string | null>(null)
  // v0.2.1: 视觉辅助模型配置弹窗
  const [visionPrompt, setVisionPrompt] = useState(false)
  const [visionPick, setVisionPick] = useState('')
  const p = providers[selIdx] || providers[0]
  const g = general as any
  // v0.2.1: 多媒体供应商
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const addMediaProvider = useSettingsStore(s => s.addMediaProvider)
  const removeMediaProvider = useSettingsStore(s => s.removeMediaProvider)
  const updateMediaProvider = useSettingsStore(s => s.updateMediaProvider)
  const [mediaSelIdx, setMediaSelIdx] = useState(0)
  const [showNewMedia, setShowNewMedia] = useState(false)
  const [newMediaName, setNewMediaName] = useState('')
  const [newMediaKey, setNewMediaKey] = useState('')
  const [newMediaUrl, setNewMediaUrl] = useState('')
  const [newMediaType, setNewMediaType] = useState('multi')
  const [imgInput, setImgInput] = useState<string | null>(null)
  const [videoInput, setVideoInput] = useState<string | null>(null)
  const [audioInput, setAudioInput] = useState<string | null>(null)
  const mp = mediaProviders[mediaSelIdx] || mediaProviders[0]
  // v0.2.1: MCP / 技能 章节
  const [mcpServers, setMcpServers] = useState<any[]>([])
  const [skillsList, setSkillsList] = useState<any[]>([])
  const [mcpName, setMcpName] = useState(''); const [mcpCmd, setMcpCmd] = useState(''); const [mcpArgs, setMcpArgs] = useState('')
  const [mcpSseName, setMcpSseName] = useState(''); const [mcpSseUrl, setMcpSseUrl] = useState('')
  const [skillName, setSkillName] = useState(''); const [skillContent, setSkillContent] = useState('')
  const [skillUrl, setSkillUrl] = useState('')
  useEffect(() => {
    if (tab === 'mcp') { window.huangquan.mcpList?.().then((s: any) => setMcpServers(s || [])).catch(() => setMcpServers([])) }
    if (tab === 'skills') { window.huangquan.skills.list().then((s: any) => setSkillsList(s || [])).catch(() => setSkillsList([])) }
    // v0.2.1: 引擎页自动加载真实存储统计
    if (tab === 'stats') { window.huangquan.modelStats.get().then((d: any) => setModelStats(d?.models || {})).catch(() => setModelStats({})) }
    if (tab === 'advanced') {
      window.huangquan.storageStats().then((s: any) => { const patch: any = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; save(patch) }).catch(() => {})
      // v0.2.6: 工具缓存命中率
      window.huangquan.cacheStats().then((cs: any) => { save({ stat_cacheHits: cs?.hits || 0, stat_cacheMisses: cs?.misses || 0, stat_cacheRate: cs?.hit_rate || '0%' }) }).catch(() => {})
    }
  }, [tab])

  const saveTimer = useRef<any>(null)
  const save = (patch: Record<string, any>) => { useSettingsStore.setState(s => ({ general: { ...s.general, ...patch } })); clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const toHex = (c: string) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : '#0D0D1A')

  // v0.2.3-fix(S1): 长期记忆计数用 state(不再在 JSX 里渲染 async IIFE -> [object Promise])
  const [factsCount, setFactsCount] = useState(0)
  useEffect(() => {
    if (tab === 'memory') {
      window.huangquan.memory.load().then((m: any) => { setMemF(m?.pinnedFacts || []); setFactsCount((m?.facts || []).length) }).catch(() => {})
    }
  }, [tab])

  const selectProvider = (name: string) => {
    const idx = providers.findIndex(x => x.name === name)
    if (idx >= 0) { setSelIdx(idx); return }
    const pre = PRESETS[name] || { type: 'OpenAI Compatible', url: '' }
    addProvider({ id: 'auto_' + Date.now(), name, type: pre.type, apiKey: '', baseUrl: pre.url, models: [], selectedModel: '' })
    setSelIdx(providers.length)
  }

  const fetchModels = async () => {
    if (!p || !p.baseUrl) return; setLoading(true)
    try {
      // v0.2.2: detect 返回 { ok, models, error }，Anthropic 用 x-api-key 鉴权
      const r: any = await window.huangquan.models.detect(p.baseUrl, p.apiKey, p.type === 'Anthropic Claude')
      const models = (r?.ok ? r.models : []) as string[]
      if (models.length) {
        updateProvider(p.id, { models, selectedModel: models[0] })
        // v0.2.1: 该供应商无视觉模型时，弹出视觉辅助模型配置提示
        const hasVision = models.some((m: string) => /gpt-4o|gpt-4-turbo|gpt-4\.1|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(m.toLowerCase()))
        if (!hasVision) {
          const otherVision = providers.filter(pr => pr.id !== p.id).flatMap(pr => (pr.models || []).filter((m: string) => /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(m.toLowerCase())).map((m: string) => ({ id: pr.id, name: pr.name, m })))
          if (otherVision.length) setVisionPrompt(true)
          else showToast('该供应商无视觉模型；可稍后在多模型策略中配置视觉辅助模型')
        }
      } else showToast('读取失败：' + (r?.error || '未获取到模型列表'))
    } catch { showToast('读取失败：请求异常') }
    setLoading(false)
  }

  // v0.2.2: 多媒体供应商 —— 读取模型并按能力自动分类（图片/视频/语音）
  const [mediaLoading, setMediaLoading] = useState(false)
  // v0.2.2: 测试连接 —— 文字供应商 / 多媒体共用
  const [testState, setTestState] = useState<{ key: string; loading: boolean; ok?: boolean; msg?: string }>({ key: '', loading: false })
  const testConnection = async (key: string, baseUrl: string, apiKey: string, isAnthropic?: boolean) => {
    setTestState({ key, loading: true })
    try {
      const r: any = await window.huangquan.models.test(baseUrl, apiKey, isAnthropic ? { anthropic: true } : undefined)
      setTestState({ key, loading: false, ok: !!r?.ok, msg: (r?.message || '测试完成') + (r?.latency ? '（' + r.latency + 'ms）' : '') })
    } catch { setTestState({ key, loading: false, ok: false, msg: '测试请求失败' }) }
  }
  const fetchMediaModels = async () => {
    if (!mp || !mp.baseUrl) { showToast('请先填写 Base URL'); return }
    setMediaLoading(true)
    try {
      const r: any = await window.huangquan.models.detect(mp.baseUrl, mp.apiKey)
      if (!r?.ok) {
        // v0.2.2: 平台不支持 /models 接口（可灵/即梦等 REST 生成 API）→ 回退官方预置模型
        const pre = MEDIA_PRESETS[mp.name]
        if (pre && ((pre.img || []).length || (pre.video || []).length || (pre.audio || []).length)) {
          updateMediaProvider(mp.id, {
            imgModels: pre.img || [], videoModels: pre.video || [], audioModels: pre.audio || [],
            selectedImg: (pre.img || [])[0], selectedVideo: (pre.video || [])[0], selectedAudio: (pre.audio || [])[0],
          })
          showToast('接口不支持模型列表，已载入' + mp.name + '官方预置模型')
        } else {
          showToast('读取失败：' + (r?.error || '未获取到模型列表，请检查 Base URL / API Key'))
        }
        return
      }
      const all = r.models as string[]
      if (!all || !all.length) { showToast('接口正常但未返回模型列表'); return }
      const isImg = (m: string) => /image|dall|flux|stable|sdxl|midjourney|\bmj\b|imagen|draw|pic|art|绘画|文生图/i.test(m)
      const isVid = (m: string) => /video|sora|kling|可灵|runway|pika|veo|wanx?|pixeldance|moonvalley|genmo|hailuo|海螺|vidu|dreamina|即梦/i.test(m)
      const isAud = (m: string) => /tts|audio|whisper|speech|voice|suno|music|asr|stt|cosyvoice|字幕|语音|配音/i.test(m)
      const imgModels = all.filter(isImg)
      const videoModels = all.filter(isVid)
      const audioModels = all.filter(isAud)
      const rest = all.filter((m: string) => !isImg(m) && !isVid(m) && !isAud(m))
      // 未匹配的模型归入图片组（生成类 API 通常以图片模型为主），避免丢失
      updateMediaProvider(mp.id, {
        imgModels: [...imgModels, ...rest],
        videoModels,
        audioModels,
        selectedImg: imgModels[0] || rest[0] || undefined,
        selectedVideo: videoModels[0] || undefined,
        selectedAudio: audioModels[0] || undefined,
      })
      const parts = [imgModels.length + ' 图片', videoModels.length + ' 视频', audioModels.length + ' 语音']
      showToast('读取成功：' + parts.join(' / ') + (rest.length ? '（' + rest.length + ' 个未分类归入图片）' : ''))
    } catch { showToast('读取失败：请检查网络或接口地址') }
    setMediaLoading(false)
  }

  const TABS = [
    { key: 'models', icon: '🔑', label: '供应商' }, { key: 'strategy', icon: '🧠', label: '策略' },
    { key: 'persona', icon: '🎭', label: '角色' },
    { key: 'memory', icon: '🧠', label: '记忆' }, { key: 'collab', icon: '🤝', label: '协作' },
    { key: 'tools', icon: '🔧', label: '工具' }, { key: 'media', icon: '🎬', label: '多媒体' },
    { key: 'mcp', icon: '🧩', label: 'MCP' }, { key: 'skills', icon: '📚', label: '技能' },
    { key: 'skin', icon: '🎨', label: '外观' },
    { key: 'stats', icon: '📊', label: '模型缓存统计' },
    { key: 'advanced', icon: '⚙️', label: '引擎' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bg }}>
      {/* Header with search + import/export */}
      <div style={{ padding: '10px 22px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={() => onNavigate('chat')} style={{ background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 16, padding: '4px 8px', borderRadius: 6 }}>←</button>
        <input placeholder="🔍 搜索设置..." style={{ flex: 1, height: 32, background: C.input, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 11, padding: '0 12px', outline: 'none' }} onChange={e => { const v = e.target.value.toLowerCase(); if (!v) { setTab('models'); return }; for (const t of TABS) { const k = t.key + t.label; if (k.includes(v)) { setTab(t.key); break } } }} />
        <button style={S.btn('ghost')} onClick={async () => { try { const cfg = await window.huangquan.settings.load(); const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'huangquan-settings-' + new Date().toISOString().slice(0,10) + '.json' }); a.click() } catch { alert('导出失败') } }} title="导出设置">📤</button>
        <button style={S.btn('ghost')} onClick={() => { const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' }); f.onchange = async () => { try { const t = await f.files?.[0]?.text(); if (t) { const cfg = JSON.parse(t); await window.huangquan.settings.save(cfg); alert('导入成功，请重启应用'); window.location.reload() } } catch { alert('导入失败，文件格式不正确') } }; f.click() }} title="导入设置">📥</button>
        <button style={S.btn('ghost')} onClick={() => { if (confirm('重置所有设置为默认值？此操作不可撤销。')) { window.huangquan.settings.reset?.(); alert('已重置，请重启应用'); window.location.reload() } }} title="恢复默认">🔄</button>
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <div style={{ width: 140, borderRight: '1px solid ' + C.border, padding: '14px 10px', overflowY: 'auto', background: C.card }}>
          {TABS.map(t => (
            <div key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '9px 12px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500, marginBottom: 2,
              color: tab === t.key ? '#fff' : C.muted,
              background: tab === t.key ? C.accent : 'transparent',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'all .12s',
            }}><span style={{ fontSize: 15 }}>{t.icon}</span><span>{t.label}</span></div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {tab === 'models' ? <>
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: 160, borderRight: '1px solid ' + C.border, padding: '14px 10px', overflowY: 'auto' }}>
                {Object.entries(GROUPS).map(([g, names]) => (
                  <div key={g} style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>{g}</div>
                    {names.map(n => { const active = providers.findIndex(x => x.name === n) >= 0 && providers.findIndex(x => x.name === n) === selIdx
                      return <div key={n} onClick={() => selectProvider(n)} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: active ? C.accent : C.text, background: active ? C.accentBg : 'transparent', marginBottom: 2 }}>{n}</div>
                    })}
                  </div>
                ))}
                <button style={{ ...S.btn('primary'), width: '100%', marginTop: 6 }} onClick={() => setShowNew(true)}>+ 自定义</button>
              </div>
              <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
                {!p ? <div style={{ color: C.muted, fontSize: 12, padding: 40, textAlign: 'center' }}>选择左侧服务商</div> : <>
                  <div style={S.card}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>服务配置</span>
                      <button style={S.btn('danger')} onClick={() => removeProvider(p.id)}>删除</button>
                    </div>
                    <div style={S.row}><div style={S.label}>API Key{PRESETS[p.name]?.noKey ? '（本地服务无需）' : ''}</div>
                      <input style={S.inp} type="password" value={p.apiKey || ''} placeholder={PRESETS[p.name]?.noKey ? '本地服务无需密钥' : 'sk-...'} onChange={e => updateProvider(p.id, { apiKey: e.target.value })} /></div>
                    <div style={S.row}><div style={S.label}>Base URL</div><input style={S.inp} value={p.baseUrl || ''} onChange={e => updateProvider(p.id, { baseUrl: e.target.value })} /></div>
                    <div style={S.row}><div style={S.label}>API 类型</div><select style={S.sel} value={p.type || 'OpenAI Compatible'} onChange={e => updateProvider(p.id, { type: e.target.value })}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                    <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>Headers</div><textarea style={{ ...S.inp, height: 44, resize: 'vertical', padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }} placeholder="key=value" value={(p as any).headers || ''} onChange={e => updateProvider(p.id, { headers: e.target.value } as any)} /></div>
                  </div>
                  <div style={S.card}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>模型列表</div>
                    {p.models.length === 0 ? <div style={{ color: C.muted, fontSize: 11, padding: '12px 0' }}>暂无，点击"读取模型"从接口获取</div> : p.models.map((m: string, i: number) => {
                      // v0.2.1: 多媒体能力标注 —— 视觉模型可看懂图片
                      const isMulti = /gpt-4o|gpt-4-turbo|gpt-4\.1|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava|audio|whisper|tts/i.test(m.toLowerCase())
                      return <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                        <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                        <span title={isMulti ? '多媒体模型：可读文字 + 看懂图片' : '文字模型：仅文字'} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, flexShrink: 0, background: isMulti ? 'rgba(72,201,138,.12)' : 'rgba(255,255,255,.05)', color: isMulti ? '#48c98a' : '#78789A', border: '1px solid ' + (isMulti ? 'rgba(72,201,138,.3)' : 'rgba(255,255,255,.1)') }}>{isMulti ? '🎨 多媒体' : '📄 文字'}</span>
                        <select style={{ ...S.sel, height: 30, fontSize: 11, width: 110, flexShrink: 0 }} value={p.selectedModel === m ? m : p.selectedModel || p.models[0]} onChange={e => { updateProvider(p.id, { selectedModel: e.target.value }); updateContextLimit(e.target.value) }}>{p.models.map(x => <option key={x} value={x}>{x}</option>)}</select>
                        <button style={{ ...S.btn('ghost'), height: 28, padding: '0 6px', fontSize: 10, flexShrink: 0 }} onClick={() => updateProvider(p.id, { models: p.models.filter((_, j) => j !== i) } as any)}>×</button>
                      </div>
                    })}
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
                      {modelInput !== null ? <>
                        <input style={{...S.inp,width:200,height:30,fontSize:11}} placeholder="模型 ID..." value={modelInput} onChange={e=>setModelInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&modelInput.trim()){updateProvider(p.id,{models:[...p.models,modelInput.trim()]} as any);setModelInput(null)}}} autoFocus />
                        <button style={{...S.btn('primary'),height:30}} onClick={()=>{if(modelInput.trim()){updateProvider(p.id,{models:[...p.models,modelInput.trim()]} as any);setModelInput(null)}}}>确认</button>
                        <button style={{...S.btn('ghost'),height:30}} onClick={()=>setModelInput(null)}>取消</button>
                      </> : <button style={S.btn('primary')} onClick={() => setModelInput('')}>添加模型</button>}
                      <button style={S.btn('ghost')} disabled={loading} onClick={fetchModels}>{loading ? '读取中...' : '读取模型'}</button>
                      {/* v0.2.2: 测试连接 */}
                      <button style={S.btn('ghost')} disabled={testState.loading} onClick={() => testConnection('provider:' + p.id, p.baseUrl, p.apiKey, p.type === 'Anthropic Claude')}>{testState.loading && testState.key === 'provider:' + p.id ? '测试中...' : '🔌 测试连接'}</button>
                      {testState.key === 'provider:' + p.id && testState.msg && (
                        <span style={{ fontSize: 10, color: testState.ok ? '#48c98a' : '#ff4466', marginLeft: 4 }}>{testState.ok ? '✓ ' : '✗ '}{testState.msg}</span>
                      )}
                    </div>
                  </div>
                  <div style={{ ...S.card, marginBottom: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>调度绑定</div>
                    <div style={S.row}><div style={S.label}>小模型</div><select style={S.sel} value={(p as any).smallModel || ''} onChange={e => updateProvider(p.id, { smallModel: e.target.value } as any)}><option value="">默认</option>{p.models.map((m: string) => <option key={m} value={m}>{m}</option>)}</select><div style={S.hint}>轻量任务</div></div>
                    <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>大模型</div><select style={S.sel} value={(p as any).largeModel || ''} onChange={e => updateProvider(p.id, { largeModel: e.target.value } as any)}><option value="">默认</option>{p.models.map((m: string) => <option key={m} value={m}>{m}</option>)}</select><div style={S.hint}>复杂任务</div></div>
                  </div>
                </>}
              </div>
            </div>
            {showNew ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setShowNew(false)}>
              <div style={{ ...S.card, width: 380, padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 18 }}>自定义供应商</div>
                <input style={{ ...S.inp, marginBottom: 10 }} placeholder="名称" value={newName} onChange={e => setNewName(e.target.value)} />
                <input style={{ ...S.inp, marginBottom: 10 }} placeholder="API Key" value={newKey} onChange={e => setNewKey(e.target.value)} />
                <input style={{ ...S.inp, marginBottom: 10 }} placeholder="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
                <select style={{ ...S.sel, marginBottom: 14, width: '100%' }} value={newType} onChange={e => setNewType(e.target.value)}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button style={S.btn('ghost')} onClick={() => setShowNew(false)}>取消</button><button style={S.btn('primary')} onClick={() => { if (!newName) return; addProvider({ id: 'custom_' + Date.now(), name: newName, type: newType, apiKey: newKey, baseUrl: newUrl, models: [], selectedModel: '' }); setShowNew(false) }}>保存</button></div>
              </div>
            </div> : null}
            {/* v0.2.1: 视觉辅助模型配置弹窗 */}
            {visionPrompt ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setVisionPrompt(false)}>
              <div style={{ ...S.card, width: 420, padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 8 }}>👁️ 该供应商无视觉模型</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 16 }}>当前供应商的模型仅支持文字。如需分析图片，请从其他已配置的供应商中选择一个视觉辅助模型：</div>
                <select style={{ ...S.sel, width: '100%', marginBottom: 14 }} value={visionPick} onChange={e => setVisionPick(e.target.value)}>
                  <option value="">— 选择视觉辅助模型 —</option>
                  {providers.filter(pr => pr.id !== p.id && (pr.models || []).some((m: string) => /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(m.toLowerCase()))).map(pr => (
                    <optgroup key={pr.id} label={pr.name}>
                      {(pr.models || []).filter((m: string) => /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(m.toLowerCase())).map((m: string) => <option key={m} value={m}>{m}</option>)}
                    </optgroup>
                  ))}
                </select>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button style={S.btn('ghost')} onClick={() => setVisionPrompt(false)}>暂不配置</button>
                  <button style={S.btn('primary')} onClick={() => { if (visionPick) { save({ visionModel: visionPick }); showToast('视觉辅助模型已设置：' + visionPick) } setVisionPrompt(false) }}>确认配置</button>
                </div>
              </div>
            </div> : null}
          </> : tab === 'strategy' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              {/* 多模型策略 —— 联动供应商（文字模型）与多媒体（图片/视频/语音模型） */}
              <div style={S.card}>
                <div style={S.section}>🧠 多模型策略</div>
                <div style={S.hint}>统一调度各能力模型：文字对话、视觉理解、图片生成、视频生成、语音识别，全部联动下方已配置的供应商与媒体平台</div>
                {/* 文字模型（联动供应商） */}
                <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, margin: '10px 0 6px' }}>📄 文字模型（联动供应商）</div>
                <div style={S.row}><div style={S.label}>主对话模型</div><select style={S.sel} value={g.mainModel||''} onChange={e=>save({mainModel:e.target.value})}><option value="">跟随默认供应商</option>{providers.flatMap(pr => (pr.models||[]).map(m => ({ id: pr.id+'::'+m, label: pr.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>日常对话与任务执行</div></div>
                <div style={S.row}><div style={S.label}>长文本模型</div><select style={S.sel} value={g.longTextModel||''} onChange={e=>save({longTextModel:e.target.value})}><option value="">跟随主模型</option>{providers.flatMap(pr => (pr.models||[]).map(m => ({ id: pr.id+'::'+m, label: pr.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>文档分析 / 长上下文任务</div></div>
                <div style={S.row}><div style={S.label}>代码模型</div><select style={S.sel} value={g.codeModel||''} onChange={e=>save({codeModel:e.target.value})}><option value="">跟随主模型</option>{providers.flatMap(pr => (pr.models||[]).map(m => ({ id: pr.id+'::'+m, label: pr.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>代码生成 / 审查</div></div>
                <div style={S.row}><div style={S.label}>快速响应模型</div><select style={S.sel} value={g.fastModel||''} onChange={e=>save({fastModel:e.target.value})}><option value="">跟随主模型</option>{providers.flatMap(pr => (pr.models||[]).map(m => ({ id: pr.id+'::'+m, label: pr.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select><div style={S.hint}>简单任务 / 工具调度</div></div>
                <Toggle checked={g.autoFastModel !== false} onChange={v=>save({autoFastModel:v})} label="简单任务自动使用快速模型" hint="Token < 2000 且 工具调用 ≤ 2 次时切换" />
              </div>
              <div style={S.card}>
                <div style={S.section}>👁️ 视觉理解（联动供应商 + 多媒体）</div>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>勾选要用的视觉辅助模型（<b style={{color:C.text}}>顺序即优先级</b>）：优先尝试排在前面的，连不通自动切换下一个，全部失败会提示原因</div>
                {(() => {
                  // v0.2.3: 候选池 = 已配置且有 key 的供应商 + 多媒体（模型名含视觉关键词）
                  const visCands: { id: string; label: string; pname: string; mname: string; keyed: boolean }[] = []
                  const pushFrom = (pname: string, models: string[], keyed: boolean) => {
                    const hits = (models || []).filter((m: string) => /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava|agnes-image|seedream|cogview/i.test(m.toLowerCase()))
                    hits.forEach((m: string) => { const id = pname + '::' + m; if (!visCands.some(c => c.id === id)) visCands.push({ id, label: pname + ' · ' + m, pname, mname: m, keyed }) })
                  }
                  providers.forEach(pr => pushFrom(pr.name, pr.models || [], !!pr.apiKey))
                  mediaProviders.forEach(mp => pushFrom(mp.name, [...(mp.imgModels||[]), ...(mp.videoModels||[]), ...(mp.audioModels||[])], !!mp.apiKey))
                  // 无视觉关键词命中的供应商: 若该供应商有 key, 显示其第一个模型作为候选（可能有视觉能力但名字不含关键词）
                  providers.forEach(pr => { if (pr.apiKey && (pr.models||[]).length && !visCands.some(c => c.pname === pr.name)) visCands.push({ id: pr.name + '::' + (pr.models||[])[0], label: pr.name + ' · ' + (pr.models||[])[0] + '（自动）', pname: pr.name, mname: (pr.models||[])[0], keyed: true }) })
                  const curList: string[] = Array.isArray(g.visionModels) ? [...g.visionModels] : (g.visionModel ? [g.visionModel] : [])
                  const toggleVis = (id: string) => {
                    const next = curList.includes(id) ? curList.filter(x => x !== id) : [...curList, id]
                    save({ visionModels: next, visionModel: next.length ? next[0] : '' })
                  }
                  const moveVis = (id: string, dir: -1 | 1) => {
                    const i = curList.indexOf(id)
                    if (i < 0) return
                    const j = i + dir
                    if (j < 0 || j >= curList.length) return
                    const next = [...curList]
                    ;[next[i], next[j]] = [next[j], next[i]]
                    save({ visionModels: next, visionModel: next[0] })
                  }
                  return (
                    <div style={{ border: '1px solid ' + C.border, borderRadius: 8, padding: '6px 8px', maxHeight: 180, overflowY: 'auto', background: C.input }}>
                      {visCands.length === 0 && <div style={{ fontSize: 11, color: C.muted, padding: 6 }}>暂无已配置的视觉模型候选（请先在 供应商/多媒体 中填入 API Key 并读取模型）</div>}
                      {visCands.map(c => {
                        const idx = curList.indexOf(c.id)
                        const on = idx >= 0
                        return (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 2px', fontSize: 11, color: on ? C.text : C.label }}>
                            <input type="checkbox" checked={on} onChange={() => toggleVis(c.id)} style={{ accentColor: C.accent }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{on && <b style={{ color: C.accent }}>#{idx + 1}</b>} {c.label}{!c.keyed && <span style={{ color: '#ffaa00' }}>（未填Key）</span>}</span>
                            <span style={{ display: 'flex', gap: 2 }}>
                              <button style={{ ...S.btn('ghost'), height: 20, padding: '0 6px', fontSize: 10 }} onClick={() => moveVis(c.id, -1)} disabled={!on || idx === 0}>↑</button>
                              <button style={{ ...S.btn('ghost'), height: 20, padding: '0 6px', fontSize: 10 }} onClick={() => moveVis(c.id, 1)} disabled={!on || idx === curList.length - 1}>↓</button>
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
                <Toggle checked={g.visionAutoSwitch !== false} onChange={v=>save({visionAutoSwitch:v})} label="自动切换" hint="视觉任务时自动切到视觉模型，完成后恢复原模型" />
              </div>
              <div style={S.card}>
                <div style={S.section}>🖼️ 图片生成（联动多媒体）</div>
                <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaImgProvider||''} onChange={e=>save({mediaImgProvider:e.target.value})}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.imgModels||[]).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select><div style={S.hint}>选择多媒体平台中的图片生成供应商</div></div>
                <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaImgModel||''} onChange={e=>save({mediaImgModel:e.target.value})}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.imgModels||[]).length).flatMap(mp2 => (mp2.imgModels||[]).map(m => ({ id: mp2.id+'::'+m, label: mp2.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
                <div style={S.row}><div style={S.label}>默认模式</div><select style={S.sel} value={g.mediaImgMode||'text2image'} onChange={e=>save({mediaImgMode:e.target.value})}><option value="text2image">文生图 text2image</option><option value="image2image">图生图 image2image</option></select></div>
                <div style={S.row}><div style={S.label}>默认比例</div><select style={S.sel} value={g.mediaImgRatio||'1:1'} onChange={e=>save({mediaImgRatio:e.target.value})}>{[['1:1','1:1'],['16:9','16:9'],['9:16','9:16'],['4:3','4:3'],['3:4','3:4'],['3:2','3:2'],['2:3','2:3'],['21:9','21:9']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
                <div style={S.row}><div style={S.label}>默认并发</div><input type="number" style={S.num} min={1} max={9} value={g.mediaImgConcurrency||1} onChange={e=>save({mediaImgConcurrency:parseInt(e.target.value)||1})} /><span style={S.hint}>一次生成张数（1~9）</span></div>
              </div>
              <div style={S.card}>
                <div style={S.section}>🎬 视频生成（联动多媒体）</div>
                <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaVideoProvider||''} onChange={e=>save({mediaVideoProvider:e.target.value})}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.videoModels||[]).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select></div>
                <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaVideoModel||''} onChange={e=>save({mediaVideoModel:e.target.value})}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.videoModels||[]).length).flatMap(mp2 => (mp2.videoModels||[]).map(m => ({ id: mp2.id+'::'+m, label: mp2.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
                <div style={S.row}><div style={S.label}>默认模式</div><select style={S.sel} value={g.mediaVideoMode||'text2video'} onChange={e=>save({mediaVideoMode:e.target.value})}><option value="text2video">文生视频 text2video</option><option value="image2video">图生视频 image2video</option></select></div>
                <div style={S.row}><div style={S.label}>默认时长</div><input type="range" min={4} max={15} value={g.mediaVideoDuration||5} onChange={e=>save({mediaVideoDuration:parseInt(e.target.value)})} style={{ flex: 1 }} /><span style={S.hint}>{g.mediaVideoDuration||5} 秒</span></div>
              </div>
              <div style={S.card}>
                <div style={S.section}>🎙️ 语音识别 / 合成（联动多媒体）</div>
                <div style={S.row}><div style={S.label}>默认平台</div><select style={S.sel} value={g.mediaAudioProvider||''} onChange={e=>save({mediaAudioProvider:e.target.value})}><option value="">自动探测</option>{mediaProviders.filter(mp2 => (mp2.audioModels||[]).length).map(mp2 => <option key={mp2.id} value={mp2.id}>{mp2.name}</option>)}</select></div>
                <div style={S.row}><div style={S.label}>默认模型</div><select style={S.sel} value={g.mediaAudioModel||''} onChange={e=>save({mediaAudioModel:e.target.value})}><option value="">跟随平台默认</option>{mediaProviders.filter(mp2 => (mp2.audioModels||[]).length).flatMap(mp2 => (mp2.audioModels||[]).map(m => ({ id: mp2.id+'::'+m, label: mp2.name+' · '+m }))).map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
                <Toggle checked={g.ttsEnabled !== false} onChange={v=>save({ttsEnabled:v})} label="启用语音合成 (TTS)" />
                {/* v0.2.3: ASR 语音识别未实现引擎, 已移除 */}
              </div>
            </div> : tab === 'persona' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>基础身份</div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 14, alignItems: 'center' }}>
                  <div style={{ width: 52, height: 52, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                    {g.agentAvatarImage ? <img src={g.agentAvatarImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (g.agentAvatar || '泉')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={S.label}>名称</div><input style={S.inp} value={g.agentName || '黄泉'} onChange={e => save({ agentName: e.target.value })} />
                  </div>
                </div>
                <div style={S.row}><div style={S.label}>称呼用户为</div><input style={S.inp} value={g.userAlias || '老板'} onChange={e => save({ userAlias: e.target.value })} /></div>
                <div style={S.row}><div style={S.label}>语言</div><select style={S.sel} value={g.language||'zh'} onChange={e=>save({language:e.target.value})}><option value="zh">中文（简体）</option><option value="zh-tw">中文（繁体）</option><option value="en">English</option><option value="ja">日本語</option><option value="auto">自动检测</option><option value="match">始终用提问语言回复</option></select></div>
                <div style={S.row}>
                  <div style={S.label}>角色预设</div>
                  <select style={S.sel} value={g.rolePreset || ''} onChange={e => { const v = e.target.value; if (v === 'custom' || v === '') save({ rolePreset: '', chatPersona: chatPersona, workPersona: workPersona }); else { const P = { huangquan: [DEFAULT_CHAT_PERSONA, DEFAULT_WORK_PERSONA], tech: ['全栈技术助手。精通前后端、数据库、DevOps。代码优先，精简注释。输出结构清晰：先结论后细节，附可运行代码与验证方法。', '高效编码。需求→方案→实现→测试→交付。优先给出可运行的最小实现，关注 Windows 兼容性，代码含注释与边界处理，交付前自测通过。'], academic: ['学术研究导师。深度推理，引用文献，严谨表达。逻辑链完整，区分事实/推断/假设，结论带置信度与局限说明。', '严谨分析。数据驱动，标注来源，区分事实与推断。先定义问题再建框架，逐层论证，结论可复核。'], creative: ['创意写作伙伴。风格多样，善于比喻和场景描写。语言有画面感，节奏张弛有度，情感自然不做作。', '创意产出。天马行空但可落地，交付完整作品。先给创意方向再写正文，风格与篇幅按需调整。'], pm: ['项目经理。结构化沟通，关注节点和风险。会议纪要、任务拆解、进度跟踪、风险预案，事事有回音。', '项目管理。拆解任务、排期、识别风险、跟进验收。WBS 拆解→排期→里程碑→风险登记→验收清单，全程可追踪。'], ops: ['运维工程师。系统监控、部署、故障排查。操作前先评估影响面，步骤可回滚，故障有根因分析。', '运维执行。先备份再操作，步骤可回滚，故障有根因。变更前评估影响面，变更后验证，出问题先恢复再定位。'], analyst: ['数据分析师。统计方法、可视化、业务洞察。结论有数据支撑，图表清晰，洞察可落地。', '数据分析。先清洗再建模，结论带置信度。明确指标口径→ETL→EDA→建模→可视化→业务建议，每一步可复现。'] }[v] || ['', '']; save({ rolePreset: v, chatPersona: P[0], workPersona: P[1] }) } }}>
                    <option value="custom">✏️ 自定义</option>
                    <option value="huangquan">🌸 黄泉（崩坏：星穹铁道）</option>
                    <option value="tech">全栈技术助手</option>
                    <option value="academic">学术研究导师</option>
                    <option value="creative">创意写作伙伴</option>
                    <option value="pm">项目经理</option>
                    <option value="ops">运维工程师</option>
                    <option value="analyst">数据分析师</option>
                  </select>
                  <div style={S.hint}>选择预设会同时填充下方聊天/工作人设；选「自定义」则保留自己编写的内容</div>
                </div>
              </div>
              {/* 人设编辑（与角色预设联动：预设填充这里，手写即自动视为自定义） */}
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ ...S.section, marginBottom: 0 }}>聊天人设</div>
                  {g.rolePreset && g.rolePreset !== 'custom' ? <span style={{ fontSize: 9, color: C.accent, background: C.accentBg, padding: '2px 8px', borderRadius: 8 }}>来自预设：{g.rolePreset}</span> : <span style={{ fontSize: 9, color: C.muted }}>自定义</span>}
                </div>
                <textarea readOnly={!!(g.rolePreset && g.rolePreset !== 'custom')} style={{ ...S.inp, height: 100, resize: 'vertical', padding: '10px', fontSize: 11, lineHeight: 1.6, ...(g.rolePreset && g.rolePreset !== 'custom' ? { opacity: 0.75, cursor: 'not-allowed' } : {}) }} value={chatPersona} onChange={e => { setChatPersona(e.target.value); save({ chatPersona: e.target.value }); if (g.rolePreset && g.rolePreset !== 'custom') save({ rolePreset: 'custom' }) }} placeholder="聊天模式下的行为风格；编写后自动切换为「自定义」" />
              </div>
              <div style={S.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ ...S.section, marginBottom: 0 }}>工作人设</div>
                  {g.rolePreset && g.rolePreset !== 'custom' ? <span style={{ fontSize: 9, color: C.accent, background: C.accentBg, padding: '2px 8px', borderRadius: 8 }}>来自预设：{g.rolePreset}</span> : <span style={{ fontSize: 9, color: C.muted }}>自定义</span>}
                </div>
                <textarea readOnly={!!(g.rolePreset && g.rolePreset !== 'custom')} style={{ ...S.inp, height: 100, resize: 'vertical', padding: '10px', fontSize: 11, lineHeight: 1.6, fontFamily: 'monospace', ...(g.rolePreset && g.rolePreset !== 'custom' ? { opacity: 0.75, cursor: 'not-allowed' } : {}) }} value={workPersona} onChange={e => { setWorkPersona(e.target.value); save({ workPersona: e.target.value }); if (g.rolePreset && g.rolePreset !== 'custom') save({ rolePreset: 'custom' }) }} placeholder="工作模式下的执行规范；编写后自动切换为「自定义」" />
              </div>
              <div style={S.card}>
                <div style={S.section}>语气与表达</div>
                <div style={S.label}>风格基调</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                  {['专业正式','实用直接','轻松友好','极简克制'].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 10, color: (g.toneStyle || '实用直接') === s ? '#fff' : C.muted, background: (g.toneStyle || '实用直接') === s ? C.accent : 'transparent' }}><input type="radio" style={{ display: 'none' }} checked={(g.toneStyle || '实用直接') === s} onChange={() => save({ toneStyle: s })} />{s}</label>)}
                </div>
                <div style={{ marginTop: 12 }}>
                  <div style={S.label}>详细程度</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: C.muted }}>简洁</span>
                    <input type="range" min="0" max="4" value={g.verbosity || 2} onChange={e => save({ verbosity: parseInt(e.target.value) })} style={{ flex: 1 }} />
                    <span style={{ fontSize: 9, color: C.muted }}>详尽</span>
                  </div>
                </div>
                <div style={{ marginTop: 10 }}>
                  <div style={S.label}>结构化偏好</div>
                  {[['useTables','优先使用表格'],['useLists','优先使用列表'],['useEmoji','使用 Emoji 点缀'],['autoCopy','代码块一键复制']].map(([k,l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
                </div>
                <div style={{ marginTop: 10 }}><div style={S.label}>称呼风格</div></div>
                <div style={{ display:'flex',gap:4,flexWrap:'wrap' }}>
                  {['不称呼用户','"你"','"您"',(g.userAlias||'老板')].map(s => <label key={s} style={{ display:'flex',alignItems:'center',gap:4,padding:'3px 8px',borderRadius:4,border:'1px solid '+C.border,cursor:'pointer',fontSize:9,color:(g.addressStyle||'你')===s?'#fff':C.muted,background:(g.addressStyle||'你')===s?C.accent:'transparent' }}><input type="radio" style={{display:'none'}} checked={(g.addressStyle||'你')===s} onChange={()=>save({addressStyle:s})}/>{s}</label>)}
                </div>
                <div style={{ marginTop: 10 }}><div style={S.label}>不确定表达</div></div>
                {[['expressUncertainty','不确定时明确说"不确定"'],['askWhenMissing','信息不足时主动追问，不脑补'],['showConfidence','对关键事实标注置信度(高/中/低)']].map(([k,l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
                <div style={{ marginTop: 4 }}><div style={S.label}>敏感话题处理</div></div>
                {[['explainRefusal','拒绝回答时解释原因'],['neutralOnControversial','对争议话题保持中立']].map(([k,l]) => <Toggle key={k} checked={g[k] === true} onChange={v => save({ [k]: v })} label={l} />)}
                <div style={{ marginTop: 4 }}><div style={S.label}>收尾习惯</div></div>
                {[['noClosingPhrase','不添加固定收尾语'],['briefClosing','完成时简洁提示"完成"']].map(([k,l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
              </div>
              <div style={S.card}>
                <div style={S.section}>输出格式</div>
                <div style={S.row}><div style={S.label}>默认输出格式</div><select style={S.sel} value={g.outputFormat||'markdown'} onChange={e=>save({outputFormat:e.target.value})}><option value="markdown">Markdown</option><option value="plain">纯文本</option><option value="html">HTML</option><option value="json">JSON</option></select></div>
                <div style={S.row}><div style={S.label}>代码注释语言</div><select style={S.sel} value={g.commentLang||'zh'} onChange={e=>save({commentLang:e.target.value})}><option value="zh">中文</option><option value="en">English</option><option value="match">与用户语言一致</option></select></div>
                <div style={S.label}>数学公式渲染</div><select style={S.sel} value={g.mathRender||'katex'} onChange={e=>save({mathRender:e.target.value})}><option value="katex">KaTeX</option><option value="mathjax">MathJax</option><option value="plain">纯文本</option><option value="none">不渲染</option></select>
                <div style={S.label}>链接呈现</div><select style={S.sel} value={g.linkStyle||'auto'} onChange={e=>save({linkStyle:e.target.value})}><option value="inline">内联链接</option><option value="footnote">脚注式</option><option value="url">仅URL</option><option value="auto">自动</option></select>
              </div>
              <div style={S.card}>
                <div style={S.section}>知识域限制</div>
                <div style={S.row}><div style={S.label}>地域偏重</div><select style={S.sel} value={g.region||'none'} onChange={e=>save({region:e.target.value})}><option value="none">无偏好</option><option value="cn">中国大陆</option><option value="na">北美</option><option value="eu">欧洲</option><option value="jp">日本</option></select></div>
                <Toggle checked={g.knowledgeTimeLimit === true} onChange={v=>save({knowledgeTimeLimit:v})} label="限制知识截止日期" hint="模拟特定时期的知识范围，如仅用2022年前技术" />
                {g.knowledgeTimeLimit === true && <div style={{display:'flex',gap:8,marginTop:6}}>
                  <div style={{flex:1}}><div style={S.hint}>不早于</div><input type="date" style={S.inp} value={g.knowledgeFrom||''} onChange={e=>save({knowledgeFrom:e.target.value})} /></div>
                  <div style={{flex:1}}><div style={S.hint}>不晚于</div><input type="date" style={S.inp} value={g.knowledgeTo||''} onChange={e=>save({knowledgeTo:e.target.value})} /></div>
                </div>}
                <Toggle checked={g.knowledgeWhitelist === true} onChange={v=>save({knowledgeWhitelist:v})} label="仅使用白名单来源" hint="限制 Agent 引用的知识范围" />
                <Toggle checked={g.strictVersionAware === true} onChange={v=>save({strictVersionAware:v})} label="严格版本感知" hint="涉及API/框架时标注版本并验证兼容性" />
              </div>
              <div style={S.card}>
                <div style={S.section}>自定义系统提示词（高级）</div>
                <div style={S.hint}>可用模板变量：{'{{Name}} {{UserName}} {{Date}} {{Time}} {{OS}} {{WorkingDir}}'.split(' ').map(v=><code key={v} style={{fontSize:9,background:C.input,padding:'1px 4px',borderRadius:2,margin:'0 2px'}}>{v}</code>)}</div>
                <textarea style={{ ...S.inp, height: 120, resize: 'vertical', padding: '10px', fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5, marginTop: 8 }} value={g.customSystemPrompt || ''} onChange={e => save({ customSystemPrompt: e.target.value })} placeholder="你是 {{Name}}，专注{{Domain}}的{{Role}}。&#10;核心原则：&#10;1. 不确定时追问&#10;2. 完成前自检&#10;3. 输出结构化" />
                <div style={S.row}><div style={S.label}>注入位置</div><select style={S.sel} value={g.promptInjectPos||'end'} onChange={e=>save({promptInjectPos:e.target.value})}><option value="end">系统提示词末尾</option><option value="begin">系统提示词开头</option><option value="replace">替换默认提示词</option></select></div>
              </div>
            </div> : tab === 'memory' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>工作记忆（对话内）</div>
                <div style={S.label}>压缩策略</div>
                <select style={S.sel} value={g.compactStrategy || 'auto'} onChange={e => save({ compactStrategy: e.target.value })}>
                  <option value="auto">自动 — 达到阈值时触发</option>
                  <option value="manual">手动 — 仅用户手动触发</option>
                  <option value="off">关闭 — 溢出则截断</option>
                </select>
                <div style={S.row}><div style={S.label}>触发条件</div></div>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex:1 }}><div style={S.hint}>消息数超过</div><input type="number" style={S.inp} value={g.compactMsgCount || 20} onChange={e => save({ compactMsgCount: parseInt(e.target.value) || 20 })} /></div>
                  <div style={{ flex:1 }}><div style={S.hint}>Token 超过</div><input type="number" style={S.inp} value={g.compactTokenLimit || 50000} onChange={e => save({ compactTokenLimit: parseInt(e.target.value) || 50000 })} /></div>
                </div>
                <div style={S.row}><div style={S.label}>压缩强度</div></div>
                <div style={{ display:'flex',alignItems:'center',gap:8 }}>
                  <span style={{ fontSize:9,color:C.muted }}>保留细节</span><input type="range" min="0" max="2" value={g.compactStrength ?? 1} onChange={e => save({ compactStrength: parseInt(e.target.value) })} style={{ flex:1 }} /><span style={{ fontSize:9,color:C.muted }}>激进</span>
                </div>
                <div style={S.hint}>{['保留更多原文，压缩比约30%','平衡：保留关键信息，压缩比约50%','仅保留核心结论，压缩比约80%'][g.compactStrength ?? 1]}</div>
                <div style={{ marginTop:8 }}>
                  {[['keepUserGoals','始终保留用户核心目标和约束'],['keepPendingTasks','始终保留未完成待办事项'],['keepDecisions','始终保留重要决策和原因'],['keepRecentRaw','保留最近5条消息原文']].map(([k,l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>短期记忆（会话内）</div>
                <Toggle checked={g.shortTermMemory !== false} onChange={v => save({ shortTermMemory: v })} label="记住会话偏好" hint="本会话中确认过的参数、路径、技术选型自动沿用" />
                <div style={S.label}>会话结束时</div>
                <select style={S.sel} value={g.sessionEndAction || 'clear'} onChange={e => save({ sessionEndAction: e.target.value })}>
                  <option value="clear">自动清理（节省资源）</option>
                  <option value="keep24h">保留 24 小时以便恢复</option>
                </select>
              </div>
              <div style={S.card}><div style={S.section}>置顶记忆</div>
                <div style={S.hint}>跨会话持久化的事实，Agent 每次对话都会看到。按 Enter 添加。</div>
                <input style={{ ...S.inp, marginTop: 10, marginBottom: 12 }} placeholder="添加置顶事实..." onKeyDown={async e => { if (e.key !== 'Enter') return; const v = (e.target as HTMLInputElement).value; if (!v) return; const m = await window.huangquan.memory.load(); (m as any).pinnedFacts = [...((m as any).pinnedFacts || []), v]; await window.huangquan.memory.save(m); setMemF([...(m as any).pinnedFacts || []]); (e.target as HTMLInputElement).value = '' }} />
                {memF.length === 0 ? <div style={{ color: C.muted, fontSize: 11, textAlign: 'center', padding: 20 }}>暂无置顶记忆</div> : memF.map((f, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.input, borderRadius: 7, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{f}</span>
                  <button style={{ ...S.btn('danger'), height: 26, padding: '0 10px', fontSize: 10 }} onClick={async () => { const m = await window.huangquan.memory.load(); (m as any).pinnedFacts.splice(i, 1); await window.huangquan.memory.save(m); setMemF([...(m as any).pinnedFacts || []]) }}>删除</button>
                </div>)}
              </div>
              <div style={S.card}>
                <div style={S.section}>长期记忆</div>
                <div style={S.hint}>Agent 自动学习的事实和偏好。可浏览、搜索、删除。</div>
                <div style={{ textAlign: 'right', marginBottom: 8 }}>
                  <button style={S.btn('ghost')} onClick={async () => {
                    const m = await window.huangquan.memory.load().catch(() => ({}))
                    const facts = (m as any).facts || []
                    if (!facts.length) { alert('暂无长期记忆') }
                    else { alert(facts.map((f: string, i: number) => (i + 1) + '. ' + f.slice(0, 200)).join('\n')) }
                  }}>浏览全部 ({factsCount})</button>
                  <button style={{ ...S.btn('danger'), marginLeft: 8 }} onClick={async () => {
                    if (!confirm('清空全部长期记忆？此操作不可撤销。')) return
                    const m = await window.huangquan.memory.load()
                    ;(m as any).facts = []; await window.huangquan.memory.save(m)
                    alert('已清空')
                  }}>清空全部</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>程序记忆（技能固化）</div>
                <Toggle checked={g.programMemory !== false} onChange={v => save({ programMemory: v })} label="启用技能识别" hint="任务完成后自动检测可复用模式" />
                <Toggle checked={g.autoSkill !== false} onChange={v => save({ autoSkill: v })} label="自动推荐固化" hint="关闭则每次需人工确认后才创建技能" />
                <div style={S.label}>推荐触发条件</div>
                <div style={S.hint}>流程≥{g.skillMinSteps||3}步且无人工介入时推荐固化</div>
                <input type="number" style={S.inp} value={g.skillMinSteps||3} min={2} max={10} onChange={e => save({ skillMinSteps: parseInt(e.target.value)||3 })} />
              </div>
              <div style={S.card}>
                <div style={S.section}>情景记忆（操作追溯）</div>
                <div style={S.label}>保留时间</div>
                <select style={S.sel} value={g.episodicRetention||'30d'} onChange={e => save({ episodicRetention: e.target.value })}><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option></select>
                <Toggle checked={g.episodicRollback !== false} onChange={v => save({ episodicRollback: v })} label="支持操作回滚" hint="文件修改时自动生成备份" />
              </div>
            </div> : tab === 'collab' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>多 Agent 协作模式</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
                  {['自动','手动','关闭'].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 14px', borderRadius: 6, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 11, color: (g.collabMode || '自动') === s ? '#fff' : C.muted, background: (g.collabMode || '自动') === s ? C.accent : 'transparent' }}><input type="radio" style={{ display: 'none' }} checked={(g.collabMode || '自动') === s} onChange={() => save({ collabMode: s })} />{s}</label>)}
                </div>
                <NumSetting label="最大同时活跃 Agent" hint="" value={g.maxAgents || 5} min={1} max={10} unit="个" onChange={v => save({ maxAgents: v })} />
              </div>
              <div style={S.card}>
                <div style={S.section}>编队成员</div>
                <div style={S.hint}>点击开关启用/禁用编队成员。关闭的Agent在对话中不可被 handoff 调用。</div>
                {[
                  ['姬子','☕','总指挥官，任务分配与最终验收'],
                  ['银狼','🐺','代码审查、安全审计、质量门禁'],
                  ['螺丝咕姆','🤖','安全扫描、漏洞检测、代码加固'],
                  ['艾丝妲','📡','前后端开发、调试、重构'],
                  ['三月七','📸','数据清洗、记忆管理、上下文归档'],
                  ['黑天鹅','🦢','UI设计、图表绘制、视觉创意'],
                  ['知更鸟','🕊️','代码生成、脚本编写、自动化'],
                ].map(([name, icon, desc]) => {
                  const list = (g.disabledAgents || []) as string[]
                  const on = !list.includes(name)
                  return <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border }}>
                    <div><span style={{ fontSize: 13 }}>{icon}</span><span style={{ fontSize: 12, fontWeight: 600, color: on ? C.text : C.muted, marginLeft: 6 }}>{name}</span><span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>{desc}</span></div>
                    <div onClick={() => { const d = [...list]; if (on) d.push(name); else d.splice(d.indexOf(name), 1); save({ disabledAgents: d }) }} style={{ width: 36, height: 20, borderRadius: 10, background: on ? C.accent : C.border, cursor: 'pointer', position: 'relative', flexShrink: 0 }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 19 : 3 }} /></div>
                  </div>
                })}
              </div>
              <div style={S.card}>
                <div style={S.section}>Handoff 交接规则</div>
                <Toggle checked={g.handoffContext !== false} onChange={v => save({ handoffContext: v })} label="传递完整上下文" hint="交接时带上需求背景、已有代码、约束条件" />
                <Toggle checked={g.handoffAutoReturn !== false} onChange={v => save({ handoffAutoReturn: v })} label="完成后自动交回" hint="被交接Agent完成任务后自动回到主Agent" />
                <div style={S.row}><div style={S.label}>最大连续交接次数</div><input type="number" style={S.inp} value={g.maxHandoffChain || 3} onChange={e => save({ maxHandoffChain: parseInt(e.target.value) || 3 })} /></div>
              </div>
              <div style={S.card}>
                <div style={S.section}>交叉验证</div>
                <Toggle checked={g.crossValidation === true} onChange={v => save({ crossValidation: v })} label="启用交叉验证" hint="关键任务由两个 Agent 独立执行后对比" />
                {g.crossValidation === true && <>
                  <Toggle checked={g.cvCodeReview !== false} onChange={v => save({ cvCodeReview: v })} label="代码审查触发" hint="生成代码后自动触发" />
                  <Toggle checked={g.cvSecurity !== false} onChange={v => save({ cvSecurity: v })} label="安全相关操作" />
                  <Toggle checked={g.cvFinancial !== false} onChange={v => save({ cvFinancial: v })} label="涉及金钱/权限操作" />
                  <div style={S.label}>验证方式</div>
                  <select style={S.sel} value={g.cvMode || 'parallel'} onChange={e => save({ cvMode: e.target.value })}>
                    <option value="parallel">并行验证（同时执行后对比）</option>
                    <option value="serial">串行验证（执行→审查）</option>
                  </select>
                  <div style={S.label}>不一致处理</div>
                  <select style={S.sel} value={g.cvConflictAction || 'report'} onChange={e => save({ cvConflictAction: e.target.value })}>
                    <option value="report">汇报差异，由用户裁决</option>
                    <option value="vote">Agent 自行投票决定</option>
                    <option value="conservative">以更保守方案为准</option>
                  </select>
                </>}
              </div>
              <div style={S.card}>
                <div style={S.section}>工作流模板</div>
                <div style={S.hint}>预定义的多步骤任务自动化流程</div>
                {[
                  ['📋 代码审查流程','code-review','开发者提交→审查者审查→开发者修正',3],
                  ['📋 部署检查清单','deploy-checklist','检查配置→构建→测试→打包→...',7],
                  ['📋 每日总结','daily-summary','汇总今日工作+明日计划',1],
                ].map(([name,key,desc,steps]) => <div key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'6px 0',borderBottom:'1px solid '+C.border}}>
                  <div><div style={{fontSize:11,fontWeight:600,color:C.text}}>{name}</div><div style={S.hint}>{desc}（{steps}步）</div></div>
                  <div style={{display:'flex',gap:4}}><button style={{...S.btn('ghost'),height:24,fontSize:9,padding:'0 8px'}}>运行▶</button><button style={{...S.btn('ghost'),height:24,fontSize:9,padding:'0 8px'}}>编辑</button></div>
                </div>)}
                <div style={{textAlign:'right',marginTop:8}}><button style={S.btn('primary')}>+ 新建工作流</button></div>
              </div>
              <div style={S.card}>
                <div style={S.section}>已安装技能</div>
                <div style={S.hint}>可复用的知识/流程模块，由 Agent 自动学习或手动安装</div>
                {[
                  ['📋 Code Review','内置','代码审查流程、检查清单、最佳实践'],
                  ['📋 Project Manager','内置','项目进度追踪、里程碑管理、风险识别'],
                  ['📋 部署检查清单','手动','来源: GitHub/xxx/deploy-checklist'],
                ].map(([name,src,desc]) => <div key={name} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 0',borderBottom:'1px solid '+C.border}}>
                  <div><span style={{fontSize:11,fontWeight:600,color:C.text}}>{name}</span><span style={{fontSize:9,color:C.muted,marginLeft:6,background:C.input,padding:'1px 5px',borderRadius:3}}>{src}</span><div style={S.hint}>{desc}</div></div>
                  <div style={{display:'flex',gap:4}}><button style={{...S.btn('ghost'),height:24,fontSize:9,padding:'0 6px'}}>●启用</button><button style={{...S.btn('ghost'),height:24,fontSize:9,padding:'0 6px'}}>详情</button></div>
                </div>)}
                <div style={{display:'flex',gap:8,marginTop:10}}>
                  <button style={S.btn('primary')}>从 GitHub 安装</button>
                  <button style={S.btn('ghost')}>从本地安装</button>
                </div>
              </div>
            </div> : tab === 'media' ? <>
              <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                {/* 左侧：媒体供应商列表（预设平台直接显示） */}
                <div style={{ width: 170, borderRight: '1px solid ' + C.border, padding: '14px 10px', overflowY: 'auto', background: C.card }}>
                  <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>媒体平台</div>
                  {/* v0.2.2: 云端平台 */}
                  {Object.keys(MEDIA_PRESETS).filter(n => !isLocalMedia(n)).map((name, i) => {
                    const existing = mediaProviders.find(m => m.name === name)
                    const idx = mediaProviders.indexOf(existing as any)
                    const active = existing ? idx === mediaSelIdx : false
                    return <div key={name} onClick={() => {
                      if (existing) setMediaSelIdx(mediaProviders.indexOf(existing))
                      else { const pre = MEDIA_PRESETS[name]; const np = { id: 'media_' + Date.now(), name, type: pre.type, baseUrl: pre.url, imgModels: pre.img || [], videoModels: pre.video || [], audioModels: pre.audio || [] }; addMediaProvider(np); setMediaSelIdx(mediaProviders.length) }
                    }} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 2, color: active ? C.accent : C.text, background: active ? C.accentBg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 8, color: existing ? (active ? C.accent : '#48c98a') : C.muted }}>{existing ? (active ? '● 配置中' : '✓ 已配置') : '+ 添加'}</span>
                    </div>
                  })}
                  {/* v0.2.2: 本地服务单独分组 */}
                  {Object.keys(MEDIA_PRESETS).filter(n => isLocalMedia(n)).length > 0 && (
                    <div style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, margin: '10px 0 4px', paddingLeft: 4 }}>本地服务</div>
                  )}
                  {Object.keys(MEDIA_PRESETS).filter(n => isLocalMedia(n)).map((name, i) => {
                    const existing = mediaProviders.find(m => m.name === name)
                    const idx = mediaProviders.indexOf(existing as any)
                    const active = existing ? idx === mediaSelIdx : false
                    return <div key={name} onClick={() => {
                      if (existing) setMediaSelIdx(mediaProviders.indexOf(existing))
                      else { const pre = MEDIA_PRESETS[name]; const np = { id: 'media_' + Date.now(), name, type: pre.type, baseUrl: pre.url, imgModels: pre.img || [], videoModels: pre.video || [], audioModels: pre.audio || [] }; addMediaProvider(np); setMediaSelIdx(mediaProviders.length) }
                    }} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 2, color: active ? C.accent : C.text, background: active ? C.accentBg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                      <span style={{ fontSize: 8, color: existing ? (active ? C.accent : '#48c98a') : C.muted }}>{existing ? (active ? '● 配置中' : '✓ 已配置') : '+ 添加'}</span>
                    </div>
                  })}
                  {mediaProviders.filter(m => !MEDIA_PRESETS[m.name]).map((m, i) => (
                    <div key={m.id} onClick={() => setMediaSelIdx(mediaProviders.indexOf(m))} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, marginBottom: 2, color: mediaProviders.indexOf(m) === mediaSelIdx ? C.accent : C.text, background: mediaProviders.indexOf(m) === mediaSelIdx ? C.accentBg : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                      <span style={{ fontSize: 8, color: '#ffaa00' }}>自定义</span>
                    </div>
                  ))}
                  <button style={{ ...S.btn('primary'), width: '100%', marginTop: 6 }} onClick={() => setShowNewMedia(true)}>+ 自定义平台</button>
                </div>
                {/* 右侧：选中供应商配置 */}
                <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
                  {!mp ? <div style={{ color: C.muted, fontSize: 12, padding: 40, textAlign: 'center' }}>点击「+ 添加平台」添加媒体供应商<br />或选择左侧已添加的平台</div> : <>
                    <div style={S.card}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{mp.name} · 服务配置</span>
                        <button style={S.btn('danger')} onClick={() => removeMediaProvider(mp.id)}>删除</button>
                      </div>
                      <div style={S.row}><div style={S.label}>API Key</div><input style={S.inp} type="password" value={mp.apiKey || ''} placeholder="sk-..." onChange={e => updateMediaProvider(mp.id, { apiKey: e.target.value })} /></div>
                      <div style={S.row}><div style={S.label}>Base URL</div><input style={S.inp} value={mp.baseUrl || ''} onChange={e => updateMediaProvider(mp.id, { baseUrl: e.target.value })} /></div>
                      <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>能力类型</div>
                        <select style={S.sel} value={mp.type || 'multi'} onChange={e => updateMediaProvider(mp.id, { type: e.target.value })}>
                          <option value="image">🖼️ 图片生成</option><option value="video">🎬 视频生成</option>
                          <option value="audio">🎙️ 语音识别/合成</option><option value="multi">🧬 综合（图+视频+语音）</option>
                        </select>
                        <div style={S.hint}>模型按能力自动分类展示</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                        <button style={S.btn('primary')} disabled={mediaLoading} onClick={fetchMediaModels}>{mediaLoading ? '读取中...' : '🔍 读取模型'}</button>
                        {/* v0.2.2: 测试连接 */}
                        <button style={S.btn('ghost')} disabled={testState.loading} onClick={() => testConnection('media:' + mp.id, mp.baseUrl, mp.apiKey)}>{testState.loading && testState.key === 'media:' + mp.id ? '测试中...' : '🔌 测试连接'}</button>
                        {testState.key === 'media:' + mp.id && testState.msg && (
                          <span style={{ fontSize: 10, color: testState.ok ? '#48c98a' : '#ff4466' }}>{testState.ok ? '✓ ' : '✗ '}{testState.msg}</span>
                        )}
                        <span style={{ fontSize: 10, color: C.muted, width: '100%' }}>读取模型：自动从接口拉取并按 图片/视频/语音 分类；平台不支持列表接口时自动载入官方预置模型</span>
                      </div>
                    </div>
                    {/* 图片生成模型 */}
                    <div style={S.card}>
                      <div style={S.section}>🖼️ 图片生成模型</div>
                      {mp.imgModels?.length === 0 && <div style={{ color: C.muted, fontSize: 11, padding: '8px 0' }}>暂无图片生成模型</div>}
                      {mp.imgModels?.map((m: string, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                          <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(124,92,191,.12)', color: C.accent, border: '1px solid rgba(124,92,191,.3)' }}>🖼️ 图片</span>
                          <select style={{ ...S.sel, height: 28, fontSize: 11, width: 110, flexShrink: 0 }} value={mp.selectedImg === m ? m : mp.selectedImg || mp.imgModels[0]} onChange={e => updateMediaProvider(mp.id, { selectedImg: e.target.value })}>{mp.imgModels.map(x => <option key={x} value={x}>{x}</option>)}</select>
                          <button style={{ ...S.btn('ghost'), height: 26, padding: '0 6px', fontSize: 10, flexShrink: 0 }} onClick={() => updateMediaProvider(mp.id, { imgModels: mp.imgModels.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                        {imgInput !== null ? <>
                          <input style={{ ...S.inp, width: 220, height: 30, fontSize: 11 }} placeholder="模型 ID..." value={imgInput} onChange={e => setImgInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && imgInput.trim()) { updateMediaProvider(mp.id, { imgModels: [...mp.imgModels, imgInput.trim()] }); setImgInput(null) } }} autoFocus />
                          <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (imgInput?.trim()) { updateMediaProvider(mp.id, { imgModels: [...mp.imgModels, imgInput.trim()] }); setImgInput(null) } }}>确认</button>
                          <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setImgInput(null)}>取消</button>
                        </> : <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => setImgInput('')}>+ 添加图片模型</button>}
                      </div>
                    </div>
                    {/* 视频生成模型 */}
                    <div style={S.card}>
                      <div style={S.section}>🎬 视频生成模型</div>
                      {mp.videoModels?.length === 0 && <div style={{ color: C.muted, fontSize: 11, padding: '8px 0' }}>暂无视频生成模型</div>}
                      {mp.videoModels?.map((m: string, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                          <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(72,201,138,.12)', color: '#48c98a', border: '1px solid rgba(72,201,138,.3)' }}>🎬 视频</span>
                          <select style={{ ...S.sel, height: 28, fontSize: 11, width: 110, flexShrink: 0 }} value={mp.selectedVideo === m ? m : mp.selectedVideo || mp.videoModels[0]} onChange={e => updateMediaProvider(mp.id, { selectedVideo: e.target.value })}>{mp.videoModels.map(x => <option key={x} value={x}>{x}</option>)}</select>
                          <button style={{ ...S.btn('ghost'), height: 26, padding: '0 6px', fontSize: 10, flexShrink: 0 }} onClick={() => updateMediaProvider(mp.id, { videoModels: mp.videoModels.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                        {videoInput !== null ? <>
                          <input style={{ ...S.inp, width: 220, height: 30, fontSize: 11 }} placeholder="模型 ID..." value={videoInput} onChange={e => setVideoInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && videoInput.trim()) { updateMediaProvider(mp.id, { videoModels: [...mp.videoModels, videoInput.trim()] }); setVideoInput(null) } }} autoFocus />
                          <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (videoInput?.trim()) { updateMediaProvider(mp.id, { videoModels: [...mp.videoModels, videoInput.trim()] }); setVideoInput(null) } }}>确认</button>
                          <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setVideoInput(null)}>取消</button>
                        </> : <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => setVideoInput('')}>+ 添加视频模型</button>}
                      </div>
                    </div>
                    {/* 语音识别模型 */}
                    <div style={S.card}>
                      <div style={S.section}>🎙️ 语音识别 / 合成模型</div>
                      {mp.audioModels?.length === 0 && <div style={{ color: C.muted, fontSize: 11, padding: '8px 0' }}>暂无语音模型</div>}
                      {mp.audioModels?.map((m: string, i: number) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                          <span style={{ fontSize: 12, color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                          <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 8, background: 'rgba(255,170,0,.12)', color: '#ffaa00', border: '1px solid rgba(255,170,0,.3)' }}>🎙️ 语音</span>
                          <select style={{ ...S.sel, height: 28, fontSize: 11, width: 110, flexShrink: 0 }} value={mp.selectedAudio === m ? m : mp.selectedAudio || mp.audioModels[0]} onChange={e => updateMediaProvider(mp.id, { selectedAudio: e.target.value })}>{mp.audioModels.map(x => <option key={x} value={x}>{x}</option>)}</select>
                          <button style={{ ...S.btn('ghost'), height: 26, padding: '0 6px', fontSize: 10, flexShrink: 0 }} onClick={() => updateMediaProvider(mp.id, { audioModels: mp.audioModels.filter((_, j) => j !== i) })}>×</button>
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                        {audioInput !== null ? <>
                          <input style={{ ...S.inp, width: 220, height: 30, fontSize: 11 }} placeholder="模型 ID..." value={audioInput} onChange={e => setAudioInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && audioInput.trim()) { updateMediaProvider(mp.id, { audioModels: [...mp.audioModels, audioInput.trim()] }); setAudioInput(null) } }} autoFocus />
                          <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (audioInput?.trim()) { updateMediaProvider(mp.id, { audioModels: [...mp.audioModels, audioInput.trim()] }); setAudioInput(null) } }}>确认</button>
                          <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setAudioInput(null)}>取消</button>
                        </> : <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => setAudioInput('')}>+ 添加语音模型</button>}
                      </div>
                    </div>
                    {/* 9.4 能力查询 */}
                    <div style={S.card}>
                      <div style={S.section}>能力查询</div>
                      <div style={S.hint}>调用 media_describe-options 查看当前 provider / 模型 / 模式 / 参数支持情况</div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button style={S.btn('primary')} onClick={async () => {
                          try { const r = await (window.huangquan as any).mediaDescribe?.(); showToast(r ? String(r).slice(0, 200) : '能力查询：当前无媒体生成适配器，请先安装 jimeng-cli / Agnes 等工具') }
                          catch { showToast('能力查询失败（适配器未安装）') }
                        }}>查询支持能力</button>
                        <button style={S.btn('ghost')} onClick={async () => {
                          try { const r = await (window.huangquan as any).mediaDescribe?.({ local: true }); showToast(r ? String(r).slice(0, 200) : '本地视觉：请确认 LM Studio 已启动（http://localhost:1234/v1/models）') }
                          catch { showToast('本地探测失败') }
                        }}>探测本地视觉模型</button>
                      </div>
                    </div>
                  </>}
                </div>
              </div>
              {/* 添加媒体供应商弹窗 */}
              {showNewMedia ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setShowNewMedia(false)}>
                <div style={{ ...S.card, width: 400, padding: 24 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>添加媒体平台</div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {Object.keys(MEDIA_PRESETS).map(n => <button key={n} style={{ ...S.btn('ghost'), height: 28, fontSize: 10 }} onClick={() => { const pre = MEDIA_PRESETS[n]; addMediaProvider({ id: 'media_' + Date.now(), name: n, type: pre.type, baseUrl: pre.url, imgModels: pre.img || [], videoModels: pre.video || [], audioModels: pre.audio || [] }); setShowNewMedia(false) }}>{n}</button>)}
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, marginBottom: 8 }}>或自定义：</div>
                  <input style={{ ...S.inp, marginBottom: 8 }} placeholder="平台名称" value={newMediaName} onChange={e => setNewMediaName(e.target.value)} />
                  <input style={{ ...S.inp, marginBottom: 8 }} placeholder="API Key" value={newMediaKey} onChange={e => setNewMediaKey(e.target.value)} />
                  <input style={{ ...S.inp, marginBottom: 8 }} placeholder="Base URL" value={newMediaUrl} onChange={e => setNewMediaUrl(e.target.value)} />
                  <select style={{ ...S.sel, marginBottom: 14, width: '100%' }} value={newMediaType} onChange={e => setNewMediaType(e.target.value)}>
                    <option value="image">🖼️ 图片生成</option><option value="video">🎬 视频生成</option>
                    <option value="audio">🎙️ 语音识别/合成</option><option value="multi">🧬 综合</option>
                  </select>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button style={S.btn('ghost')} onClick={() => setShowNewMedia(false)}>取消</button>
                    <button style={S.btn('primary')} onClick={() => { if (!newMediaName) return; addMediaProvider({ id: 'media_' + Date.now(), name: newMediaName, type: newMediaType, apiKey: newMediaKey, baseUrl: newMediaUrl, imgModels: [], videoModels: [], audioModels: [] }); setShowNewMedia(false); setNewMediaName(''); setNewMediaKey(''); setNewMediaUrl('') }}>保存</button>
                  </div>
                </div>
              </div> : null}
            </> : tab === 'mcp' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>🧩 MCP 服务器（stdio）</div>
                <div style={S.hint}>通过标准输入/输出协议连接本地 MCP 服务器，为 Agent 提供外部工具</div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input style={{ ...S.inp, flex: 1 }} placeholder="服务器名称" value={mcpName} onChange={e => setMcpName(e.target.value)} />
                  <input style={{ ...S.inp, flex: 1.5 }} placeholder="启动命令（如 npx / node）" value={mcpCmd} onChange={e => setMcpCmd(e.target.value)} />
                  <input style={{ ...S.inp, flex: 1.5 }} placeholder="参数（空格分隔，如 -y @modelcontextprotocol/server-filesystem C:/）" value={mcpArgs} onChange={e => setMcpArgs(e.target.value)} />
                  <button style={S.btn('primary')} onClick={async () => { if (!mcpName || !mcpCmd) { showToast('请填写名称和命令'); return } const r = await window.huangquan.mcpConnect(mcpName, mcpCmd, mcpArgs.split(/\s+/).filter(Boolean)); showToast(typeof r === 'string' ? r : ('已连接：' + mcpName)); setMcpName(''); setMcpCmd(''); setMcpArgs(''); window.huangquan.mcpList?.().then((s: any) => setMcpServers(s || [])) }}>连接</button>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.text, margin: '8px 0 6px' }}>已连接服务器</div>
                {mcpServers.length === 0 ? <div style={{ color: C.muted, fontSize: 11 }}>暂无已连接的 MCP 服务器</div> : mcpServers.map((s: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{s.name} <span style={{ color: (s as any).status === 'connected' ? '#48c98a' : '#ffaa00', fontSize: 9 }}>{(s as any).status || 'connected'}</span></div>
                      <div style={{ fontSize: 10, color: C.muted }}>{(s as any).cmd || ''} {(s as any).args?.join(' ') || ''}</div>
                      {(s as any).tools?.length > 0 && <div style={{ fontSize: 10, color: C.accent, marginTop: 2 }}>工具：{(s as any).tools.map((t: any) => t.name || t).join(', ').slice(0, 100)}</div>}
                    </div>
                    <button style={{ ...S.btn('danger'), height: 26, fontSize: 10, padding: '0 10px' }} onClick={async () => { try { await (window.huangquan as any).mcpDisconnect?.(s.name) } catch {} showToast('已断开 ' + s.name); window.huangquan.mcpList?.().then((x: any) => setMcpServers(x || [])) }}>断开</button>
                  </div>
                ))}
              </div>
              <div style={S.card}>
                <div style={S.section}>🧩 MCP 服务器（SSE）</div>
                <div style={S.hint}>通过 HTTP SSE 端点连接远程 MCP 服务器</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.inp, flex: 1 }} placeholder="服务器名称" value={mcpSseName} onChange={e => setMcpSseName(e.target.value)} />
                  <input style={{ ...S.inp, flex: 2 }} placeholder="SSE URL（如 http://localhost:8080/sse）" value={mcpSseUrl} onChange={e => setMcpSseUrl(e.target.value)} />
                  <button style={S.btn('primary')} onClick={async () => { if (!mcpSseName || !mcpSseUrl) { showToast('请填写名称和 URL'); return } const r = await window.huangquan.mcpSSEConnect(mcpSseName, mcpSseUrl); showToast(typeof r === 'string' ? r : ('已连接：' + mcpSseName + '（' + (r as any)?.length + ' 工具）')); setMcpSseName(''); setMcpSseUrl('') }}>连接</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>MCP 行为配置</div>
                <Toggle checked={g.mcpAutoReconnect !== false} onChange={v=>save({mcpAutoReconnect:v})} label="断线自动重连" />
                <Toggle checked={g.mcpAutoConnectOnStart === true} onChange={v=>save({mcpAutoConnectOnStart:v})} label="启动时自动连接全部 MCP 服务器" />
                <div style={S.row}><div style={S.label}>启动超时</div><input type="number" style={S.num} value={g.mcpTimeout||10} onChange={e=>save({mcpTimeout:parseInt(e.target.value)||10})} /><span style={S.hint}>秒</span></div>
              </div>
            </div> : tab === 'skills' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>📚 已安装技能</div>
                <div style={S.hint}>技能是注入到系统提示词的专项能力包（SKILL.md）</div>
                {skillsList.length === 0 ? <div style={{ color: C.muted, fontSize: 11, padding: '10px 0' }}>暂无技能，可创建或从 GitHub 安装</div> : skillsList.map((sk: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{sk.name}</div>
                      <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk.description}</div>
                    </div>
                    <button style={{ ...S.btn('ghost'), height: 26, fontSize: 10, padding: '0 10px', marginLeft: 8 }} onClick={async () => { const c = await window.huangquan.skills.load(sk.path); showToast(c.slice(0, 120) + (c.length > 120 ? '…' : '')) }}>查看</button>
                    <button style={{ ...S.btn('danger'), height: 26, fontSize: 10, padding: '0 10px', marginLeft: 4 }} onClick={async () => { if (!confirm('删除技能 ' + sk.name + '？')) return; const r = await window.huangquan.skills.delete(sk.name); showToast(r === true ? '已删除' : String(r)); window.huangquan.skills.list().then((s: any) => setSkillsList(s || [])) }}>删除</button>
                  </div>
                ))}
              </div>
              <div style={S.card}>
                <div style={S.section}>➕ 创建技能</div>
                <input style={{ ...S.inp, marginBottom: 8 }} placeholder="技能名称（英文/拼音）" value={skillName} onChange={e => setSkillName(e.target.value)} />
                <textarea style={{ ...S.inp, height: 130, resize: 'vertical', padding: '10px', fontSize: 10, fontFamily: 'monospace', lineHeight: 1.5, marginBottom: 8 }} placeholder={'---\nname: 技能名\ndescription: 一句话描述\n---\n\n# 使用说明\n## 触发条件\n...' } value={skillContent} onChange={e => setSkillContent(e.target.value)} />
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button style={S.btn('primary')} onClick={async () => { if (!skillName.trim()) { showToast('请填写技能名称'); return } const r = await window.huangquan.skills.create(skillName.trim(), skillContent || '---\nname: ' + skillName + '\ndescription: ' + skillName + '\n---\n\n# ' + skillName); showToast(r === true ? '技能已创建' : String(r)); setSkillName(''); setSkillContent(''); window.huangquan.skills.list().then((s: any) => setSkillsList(s || [])) }}>创建技能</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>📦 从 GitHub 安装</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input style={{ ...S.inp, flex: 1 }} placeholder="Git 仓库地址（如 https://github.com/user/skill）" value={skillUrl} onChange={e => setSkillUrl(e.target.value)} />
                  <button style={S.btn('primary')} onClick={async () => { if (!skillUrl.trim()) { showToast('请输入 Git 地址'); return } const r = await window.huangquan.skills.install(skillUrl.trim()); showToast(r === 'ok' ? '技能安装成功' : String(r)); setSkillUrl(''); window.huangquan.skills.list().then((s: any) => setSkillsList(s || [])) }}>安装</button>
                </div>
              </div>
            </div> : tab === 'stats' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>📊 模型缓存统计</div>
                <div style={S.hint}>统计所有聊天会话中每个模型在 API 调用时的缓存命中情况。命中率 = 缓存读取 token ÷ 输入总 token(token 口径,反映实际节省的输入量;请求级命中在 DeepSeek 自动缓存下恒 100%,仅作明细参考)。数据永久本地保存(model-cache-stats.json)，重启不丢失，删除历史会话不影响统计。</div>
                {Object.keys(modelStats).length === 0 ? (
                  <div style={{ fontSize: 11, color: C.muted, padding: '12px 0', textAlign: 'center' }}>暂无使用记录 —— 调用模型产生 API 请求后，该模型会自动出现在表格中</div>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 11 }}>
                      <thead>
                        <tr style={{ color: C.muted, borderBottom: '1px solid ' + C.border, textAlign: 'left' }}>
                          <th style={{ padding: '6px 8px', fontWeight: 600 }}>模型名称</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>总请求</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>命中请求</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>缓存读取</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>缓存写入</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>命中率</th>
                          <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'center' }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(modelStats).map(([m, c]) => {
                          const reqs = c.requests || 0
                          const hitReqs = c.hitReqs || 0
                          const readT = c.readTokens || 0
                          const writeT = c.writeTokens || 0
                          const inputT = c.inputTokens || 0
                          // token 口径命中率(有区分度): 缓存读取 ÷ 输入总
                          const rate = inputT > 0 ? (readT / inputT * 100).toFixed(1) : '—'
                          const fmtTok = (n: number) => n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
                          return (
                            <tr key={m} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', color: C.text }}>
                              <td style={{ padding: '6px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m}>{m}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>{reqs}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', color: '#48c98a' }} title="命中缓存的请求数">{hitReqs}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', color: '#48c98a' }}>{fmtTok(readT)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', color: '#6ba8ff' }}>{fmtTok(writeT)}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, color: '#48c98a' }} title="缓存读取 token ÷ 输入总 token">{rate}{rate !== '—' ? '%' : ''}</td>
                              <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                <button style={{ ...S.btn('ghost'), height: 20, fontSize: 9, padding: '0 6px' }} onClick={async () => { await window.huangquan.modelStats.resetOne(m); const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}); }}>重置</button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                      <button style={{ ...S.btn('danger'), height: 24, fontSize: 10 }} onClick={async () => { if (!confirm('确定重置全部模型的缓存统计？此操作不可恢复')) return; await window.huangquan.modelStats.resetAll(); const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}) }}>重置全部模型统计</button>
                      <button style={{ ...S.btn('ghost'), height: 24, fontSize: 10 }} onClick={async () => { const s = await window.huangquan.modelStats.get(); setModelStats(s?.models || {}) }}>🔄 刷新</button>
                    </div>
                  </>
                )}
              </div>
            </div> : tab === 'skin' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}><div style={S.section}>Agent 头像</div>
                <div style={S.hint}>上传图片作为 Agent 头像，或使用 emoji 文字。留空默认"泉"。</div>
                <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                    {g.agentAvatarImage ? <img src={g.agentAvatarImage} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" /> : (g.agentAvatar || '泉')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <input style={S.inp} value={g.agentAvatar || ''} placeholder="emoji 或文字（如 🤖）" onChange={e => save({ agentAvatar: e.target.value })} maxLength={4} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} id="avatarImg" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => save({ agentAvatarImage: r.result as string }); r.readAsDataURL(f) }} />
                      <button style={S.btn('primary')} onClick={() => document.getElementById('avatarImg')?.click()}>上传图片</button>
                      {g.agentAvatarImage && <button style={S.btn('ghost')} onClick={() => save({ agentAvatarImage: '' })}>使用默认</button>}
                    </div>
                  </div>
                </div>
              </div>
              <div style={S.card}><div style={S.section}>背景图片</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} id="bgImg" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { useSettingsStore.getState().setBgImage(r.result as string) }; r.readAsDataURL(f) }} />
                  <button style={S.btn('primary')} onClick={() => document.getElementById('bgImg')?.click()}>选择图片</button>
                  {hasBg && <button style={S.btn('danger')} onClick={() => { useSettingsStore.getState().setBgImage(null) }}>清除</button>}
                </div>
                {hasBg && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                  <span style={{ fontSize: 11, color: C.label }}>透明度</span>
                  <input type="range" min="5" max="100" value={Math.round(bgOp * 100)} onChange={e => { const v = parseInt(e.target.value) / 100; setBgOp(v); useSettingsStore.getState().setBgOpacity(v) }} style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: C.text, minWidth: 36 }}>{Math.round(bgOp * 100)}%</span>
                </div>}
              </div>
              <div style={S.card}><div style={S.section}>主题预设<span style={{ float: 'right', fontWeight: 400, fontSize: 10 }}>(当前: {g.themePreset || g.theme || 'dark'})</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[
                    ['🌙 暗色科技', 'dark-tech'],
                    ['☀️ 浅色温润', 'light-warm'],
                    ['🖤 深黑极简', 'deep-black'],
                    ['🌿 护眼暗绿', 'forest'],
                    ['⚫ 高对比度', 'high-contrast'],
                    ['🎨 自定义', 'custom'],
                  ].map(([label, key]) => <div key={key} onClick={() => { if (key === 'custom') { save({ themePreset: 'custom', customColors: g.customColors || g.customTheme || { bg: '#0D0D1A', surface: '#1E1E38', accent: '#6B4C9A' } }) } else { save({ themePreset: key, customColors: undefined }) } }} style={{ padding: 12, borderRadius: 8, border: '1px solid ' + C.border, cursor: 'pointer', textAlign: 'center', background: (g.themePreset || '') === key ? C.accentBg : 'transparent' }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{label.slice(0,2)}</div><div style={{ fontSize: 10, color: (g.themePreset || '') === key ? C.accent : C.muted }}>{label.slice(2)}</div>
                  </div>)}
                </div>
                {(g.themePreset || '') === 'custom' && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed ' + C.border }}>
                  <div style={S.hint}>自定义颜色将覆盖主题对应色值，支持 hex（#RRGGBB）或取色器</div>
                  {[['背景', 'bg'], ['卡片', 'surface'], ['强调', 'accent']].map(([cn, ck]) => (
                    <div key={ck} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <span style={{ fontSize: 11, color: C.label, width: 40, flexShrink: 0 }}>{cn}</span>
                      <input type="color" value={toHex((g.customColors || g.customTheme || {})[ck])} onChange={e => save({ customColors: { ...(g.customColors || g.customTheme || {}), [ck]: e.target.value } })} style={{ width: 36, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
                      <input style={{ ...S.inp, flex: 1 }} value={(g.customColors || g.customTheme || {})[ck] || ''} placeholder="#RRGGBB" onChange={e => save({ customColors: { ...(g.customColors || g.customTheme || {}), [ck]: e.target.value } })} />
                    </div>
                  ))}
                </div>}
              </div>
              <div style={S.card}><div style={S.section}>排版</div>
                <div style={S.row}><div style={S.label}>界面字号</div><select style={S.sel} value={g.uiFontSize || 13} onChange={e => save({ uiFontSize: parseInt(e.target.value) })}>{[12,13,14,15,16,18].map(s => <option key={s} value={s}>{s}px</option>)}</select></div>
                <div style={S.row}><div style={S.label}>代码字号</div><select style={S.sel} value={g.codeFontSize || 12} onChange={e => save({ codeFontSize: parseInt(e.target.value) })}>{[11,12,13,14,15,16].map(s => <option key={s} value={s}>{s}px</option>)}</select></div>
                <div style={S.row}><div style={S.label}>消息间距</div><select style={S.sel} value={g.messageSpacing || 'comfortable'} onChange={e => save({ messageSpacing: e.target.value })}><option value="compact">紧凑</option><option value="comfortable">舒适</option><option value="loose">宽松</option></select></div>
              </div>
              <div style={S.card}><div style={S.section}>布局</div>
                <div style={S.row}><div style={S.label}>对话区最大宽度</div><input type="range" min="400" max="1200" step="50" value={g.chatMaxWidth || 800} onChange={e => save({ chatMaxWidth: parseInt(e.target.value) })} style={{ width: '100%' }} /><div style={S.hint}>{g.chatMaxWidth || 800}px</div></div>
                <Toggle checked={g.showTimestamps !== 'hover'} onChange={v => save({ showTimestamps: v ? 'always' : 'hover' })} label="始终显示时间戳" hint="关闭后仅悬停显示" />
              </div>
            </div> : tab === 'tools' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>工具总览仪表盘</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  {[
                    ['📁 文件','filesystem',['read','write','edit','mkdir','ls','grep','find']],
                    ['💻 Shell','shell',['exec_command','codebox']],
                    ['🌐 浏览器','browser',['browse','browse_screenshot','web_search','web_fetch']],
                    ['🖥️ 桌面','desktop',['screenshot','clipboard_read','clipboard_write','system_info','process_list','kill_process','read_image']],
                    ['📄 办公','office',['import_doc']],
                    ['🎨 媒体','media',['show_card']],
                    ['🗄️ 数据库','database',[]],
                    ['🌍 网络','network',['web_search','web_fetch']],
                    ['🧩 MCP','mcp',['mcp_connect','mcp_call']],
                    ['📦 插件','plugins',[]],
                    ['📅 定时','schedule',['schedule_task','list_schedules','watch_file','list_workflows','run_workflow']],
                    ['🔔 通知','notify',['bridge_notify','save_goal','list_goals','save_memory','recall_memory','audit_log']],
                  ].map(([label,cat,tools]) => {
                    const disabled = (g.disabledTools || []) as string[]
                    const enabled = tools.filter(t => !disabled.includes(t))
                    const allOn = tools.length > 0 && enabled.length === tools.length
                    const anyOn = enabled.length > 0
                    return <div key={cat} style={{ padding: 10, borderRadius: 8, border: '1px solid ' + C.border, cursor: 'pointer', background: allOn ? C.accentBg : anyOn ? 'transparent' : 'rgba(255,50,50,0.05)', opacity: tools.length === 0 ? 0.4 : 1 }}
                      onClick={() => {
                        const d = [...disabled]
                        if (allOn && tools.length > 0) tools.forEach(t => { if (!d.includes(t)) d.push(t) })
                        else tools.forEach(t => { const i = d.indexOf(t); if (i >= 0) d.splice(i,1) })
                        save({ disabledTools: d })
                      }}>
                      <div style={{ fontSize: 18, marginBottom: 2 }}>{label.slice(0,2)}</div>
                      <div style={{ fontSize: 10, color: allOn ? C.accent : C.muted }}>{label.slice(2)}{tools.length === 0 ? ' (暂未实现)' : allOn ? ' ●' : anyOn ? ' ◐' : ' ○'}</div>
                    </div>
                  })}
                </div>
                <div style={{ textAlign: 'right', marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button style={S.btn('danger')} onClick={() => save({ disabledTools: ['read','write','edit','mkdir','ls','grep','find','exec_command','codebox','browse','browse_screenshot','web_search','web_fetch','screenshot','clipboard_read','clipboard_write','system_info','process_list','kill_process','read_image','import_doc','show_card','mcp_connect','mcp_call','schedule_task','list_schedules','watch_file','list_workflows','run_workflow','bridge_notify','save_goal','list_goals','save_memory','recall_memory','audit_log'] })}>全部禁用</button>
                  <button style={S.btn('ghost')} onClick={() => save({ disabledTools: [] })}>恢复默认</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>🌐 浏览器</div>
                <div style={S.hint}>实时浏览面板(可视化查看 agent 浏览)、主窗口内使用提示、网页解析工具(Playwright 无头内核)。三类配置互不影响、真实生效。</div>

                <div style={{ fontSize: 11, fontWeight: 700, color: '#b39ddb', margin: '10px 0 4px' }}>▍实时浏览面板</div>
                <div style={S.row}><div style={S.label}>默认主页</div><input style={S.inp} placeholder="https://example.com" value={g.browserHomeUrl||''} onChange={e=>save({browserHomeUrl:e.target.value})} /><div style={S.hint}>打开浏览器窗口时自动加载的页面</div></div>
                <div style={S.row}><div style={S.label}>窗口宽度</div><input type="number" style={S.inp} value={g.browserWinW??1280} onChange={e=>save({browserWinW:parseInt(e.target.value)||1280})} /><div style={S.hint}>px,不小于 600</div></div>
                <div style={S.row}><div style={S.label}>窗口高度</div><input type="number" style={S.inp} value={g.browserWinH??860} onChange={e=>save({browserWinH:parseInt(e.target.value)||860})} /><div style={S.hint}>px,不小于 400</div></div>
                <div style={S.row}><div style={S.label}>画面刷新间隔</div><input type="number" style={S.inp} value={g.browserSnapMs??1200} onChange={e=>save({browserSnapMs:parseInt(e.target.value)||1200})} /><div style={S.hint}>ms,实时画面截图刷新频率,越小越流畅但更耗资源</div></div>

                <div style={{ fontSize: 11, fontWeight: 700, color: '#b39ddb', margin: '10px 0 4px' }}>▍使用提示(主窗口内横幅)</div>
                <div style={S.row}><div style={S.label}>使用浏览器时提示</div><Toggle checked={g.browserFloatEnabled !== false} onChange={v=>save({browserFloatEnabled:v})} label="agent 使用浏览器时在主窗口内显示提示横幅" /></div>
                <div style={S.row}><div style={S.label}>提示位置</div><select style={S.sel} value={g.browserFloatPos||'top-right'} onChange={e=>save({browserFloatPos:e.target.value})}>
                  <option value="top-right">右上角</option><option value="top-center">顶部居中</option><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option>
                </select><div style={S.hint}>横幅在主窗口内的显示位置(非系统屏幕角)</div></div>
                <div style={S.row}><div style={S.label}>提示停留</div><input type="number" style={S.inp} value={g.browserFloatTimeout??30} onChange={e=>save({browserFloatTimeout:parseInt(e.target.value)||30})} /><div style={S.hint}>秒</div></div>

                <div style={{ fontSize: 11, fontWeight: 700, color: '#b39ddb', margin: '10px 0 4px' }}>▍网页解析工具 (web_read)</div>
                <div style={S.hint}>基于 Playwright + Chromium 无头内核,Agent 调用 web_read 时临时启动、用完自动销毁,不长期驻留内存。支持 JS 动态渲染页面、提取标题与清洗后的正文、截图、转 PDF。</div>
                <div style={S.row}><div style={S.label}>启用解析工具</div><Toggle checked={g.webReadEnabled !== false} onChange={v=>save({webReadEnabled:v})} label="总开关,关闭后 Agent 无法调用 web_read" /></div>
                <div style={S.row}><div style={S.label}>强制无头模式</div><Toggle checked={g.webReadHeadless !== false} onChange={v=>save({webReadHeadless:v})} label="取消勾选则可视化弹出浏览器窗口(用于调试页面)" /></div>
                <div style={S.row}><div style={S.label}>页面加载超时</div><input type="number" style={S.inp} value={g.webReadTimeout??15000} onChange={e=>save({webReadTimeout:parseInt(e.target.value)||15000})} /><div style={S.hint}>ms</div></div>
                <div style={S.row}><div style={S.label}>自定义 User-Agent</div><input style={S.inp} placeholder="留空使用默认 UA" value={g.webReadUA||''} onChange={e=>save({webReadUA:e.target.value})} /></div>
                <div style={S.row}><div style={S.label}>HTTP 代理地址</div><input style={S.inp} placeholder="http://127.0.0.1:7890 (留空不使用)" value={g.webReadProxy||''} onChange={e=>save({webReadProxy:e.target.value})} /></div>
                <div style={S.row}><div style={S.label}>Cookie(登录态)</div><input style={S.inp} placeholder='如: session=abc123; token=xyz 或 [{"name":"session","value":"abc123","domain":".example.com"}]' value={g.webReadCookies||''} onChange={e=>save({webReadCookies:e.target.value})} /></div>
                <div style={S.hint}>用于读取需要登录/带会话的网页,支持 "k=v; k2=v2" 字符串或 JSON 数组格式;留空则不注入</div>
                <div style={S.row}><div style={S.label}>任务完成自动关闭</div><Toggle checked={g.webReadAutoClose !== false} onChange={v=>save({webReadAutoClose:v})} label="任务执行完毕自动销毁浏览器及页面进程" /></div>
                <div style={S.row}><div style={S.label}>自动清洗广告</div><Toggle checked={g.webReadCleanAds !== false} onChange={v=>save({webReadCleanAds:v})} label="读取完成自动剔除广告/导航栏等冗余元素" /></div>

                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  <button style={S.btn('primary')} onClick={() => { try { (window as any).huangquan?.web.showPanel() } catch {} }}>打开浏览器窗口</button>
                  <button style={S.btn('primary')} onClick={() => { try { (window as any).huangquan?.web.read('https://example.com', 'text').then((raw: string) => { try { const r = JSON.parse(raw); alert(r.ok ? 'web_read 自检成功\n标题: ' + r.title + '\n正文长度: ' + (r.text||'').length : 'web_read 失败: ' + r.error) } catch { alert('web_read 返回异常: ' + String(raw).slice(0,200)) } }) } catch {} }}>web_read 自检</button>
                  <button style={S.btn('ghost')} onClick={() => { save({ browserHomeUrl: '', browserFloatPos: 'top-right', browserFloatTimeout: 30, browserSnapMs: 1200, webReadEnabled: true, webReadHeadless: true, webReadTimeout: 15000, webReadUA: '', webReadProxy: '', webReadAutoClose: true, webReadCleanAds: true, webReadCookies: '' }) }}>恢复默认</button>
                </div>
              </div>
              {/* v0.2.3: 文件系统配置(参数预留)已移除 */}
              {/* v0.2.3: Shell 配置(参数预留)已移除 */}
              {/* v0.2.3: 浏览器配置(参数预留)已移除 */}
              <div style={S.card}>
                <div style={S.section}>可用工具</div>
                <div style={S.hint}>关闭不需要的工具可减少 Token 消耗，加速响应</div>
                {[
                  ['read', '读取文件'], ['write', '写入文件'], ['edit', '编辑文件'], ['exec_command', '命令执行'],
                  ['mkdir', '创建目录'], ['ls', '列出目录'], ['grep', '文本搜索'], ['find', '文件查找'],
                  ['web_search', '网页搜索'], ['web_fetch', '网页抓取'], ['browse', '浏览器'], ['browse_screenshot', '网页截图'],
                  ['screenshot', '屏幕截图'], ['clipboard_read', '读取剪贴板'], ['clipboard_write', '写入剪贴板'],
                  ['system_info', '系统信息'], ['process_list', '进程列表'], ['kill_process', '结束进程'],
                  ['codebox', '代码沙箱'], ['save_memory', '保存记忆'], ['recall_memory', '语义搜索'],
                  ['schedule_task', '定时任务'], ['list_schedules', '查看定时'],
                  ['mcp_connect', 'MCP连接'], ['mcp_call', 'MCP调用'],
                  ['handoff', 'Agent交接'], ['list_agents', '查看Agent'], ['list_workflows', '查看工作流'], ['run_workflow', '执行工作流'],
                  ['read_image', '读取图片'], ['set_workdir', '切换目录'], ['set_theme', '切换主题'],
                  ['show_card', '交互卡片'], ['bridge_notify', '桌面通知'], ['workflow', '工作流脚本'],
                  ['audit_log', '审计日志'], ['watch_file', '文件监控'], ['save_goal', '持久目标'], ['list_goals', '查看目标'],
                  ['import_doc', '导入文档'],
                ].map(([name, desc]) => {
                  const disabled = (g.disabledTools || []) as string[]
                  const on = !disabled.includes(name)
                  return <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                    <div><span style={{ fontSize: 11, fontWeight: 600, color: on ? C.text : C.muted }}>{name}</span><span style={{ fontSize: 10, color: C.muted, marginLeft: 8 }}>{desc}</span></div>
                    <div onClick={() => { const d = [...disabled]; if (on) d.push(name); else d.splice(d.indexOf(name), 1); save({ disabledTools: d }) }} style={{ width: 36, height: 20, borderRadius: 10, background: on ? C.accent : C.border, cursor: 'pointer', position: 'relative', flexShrink: 0 }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 19 : 3, transition: 'all .12s' }} /></div>
                  </div>
                })}
              </div>
              <div style={S.card}>
                <div style={S.section}>缓存管理</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
                  <div><div style={{ fontSize: 12, color: C.text }}>工具调用缓存</div><div style={S.hint}>读操作（read/ls/search）结果缓存，写操作自动失效</div></div>
                  <button style={S.btn('ghost')} onClick={async () => { try { const stats = await window.huangquan.cacheStats?.(); alert(JSON.stringify(stats, null, 2)) } catch { alert('缓存模块未加载') } }}>查看</button>
                </div>
                <div style={{ textAlign: 'right' }}><button style={S.btn('danger')} onClick={async () => { try { await window.huangquan.cacheClear?.(); alert('缓存已清空') } catch { alert('操作失败') } }}>清空缓存</button></div>
              </div>
              <div style={S.card}>
                <div style={S.section}>会话管理</div>
                <Toggle checked={g.autoSave !== false} onChange={v => save({ autoSave: v })} label="自动保存会话" hint="每次对话结束后自动保存到本地文件" />
                <NumSetting label="最大会话数" hint="超出后自动清理最早的会话" value={g.maxSessions || 50} min={5} max={200} unit="个" onChange={v => save({ maxSessions: v })} />
              </div>
              <div style={S.card}>
                <div style={S.section}>插件管理</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  {!showPluginInput ? (
                    <button style={S.btn('primary')} onClick={() => setShowPluginInput(true)}>安装插件</button>
                  ) : (
                    <div style={{ display:'flex', gap:6, flex:1 }}>
                      <input style={{...S.inp, flex:1}} placeholder="Git URL..." value={pluginUrl} onChange={e => setPluginUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && pluginUrl) { window.huangquan.plugins.install(pluginUrl).then(r => { showToast(r); setPluginUrl(''); setShowPluginInput(false) }).catch(() => showToast('安装失败')) } }} autoFocus />
                      <button style={S.btn('primary')} onClick={() => { if (pluginUrl) { window.huangquan.plugins.install(pluginUrl).then(r => { showToast(r); setPluginUrl(''); setShowPluginInput(false) }).catch(() => showToast('安装失败')) } }}>确认</button>
                      <button style={S.btn('ghost')} onClick={() => { setShowPluginInput(false); setPluginUrl('') }}>取消</button>
                    </div>
                  )}
                  <button style={S.btn('ghost')} onClick={async () => { try { const plugins = await window.huangquan.plugins.scan(); showToast(plugins.length ? plugins.map((p: any) => p.name + ' v' + p.version).join(', ') : '暂无已安装插件') } catch { showToast('插件模块未加载') } }}>扫描已安装</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>系统信息</div>
                <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                  {[
                    ['版本', 'v0.2.3'], ['Electron', '32.x'], ['React', '18.3'], ['Zustand', '4.5'],
                    ['构建', new Date().toLocaleDateString('zh-CN')], ['工具数', '27'],
                    ['Agent数', '7'], ['技能数', '4+']
                  ].map(([k, v]) => <div key={k} style={{ minWidth: 100 }}><div style={S.hint}>{k}</div><div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{v}</div></div>)}
                </div>
              </div>
            </div> : tab === 'advanced' ? <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.section}>🎮 渲染加速</div>
                <div style={S.hint}>应用自动识别本机 GPU:检测到可用 GPU 即自动启用硬件加速;无 GPU 或驱动异常时自动降级 CPU 软件渲染,无需手动指定。切换后需重启应用生效。</div>
                <div style={S.row}><div style={S.label}>渲染模式</div><select style={S.sel} value={g.rendererMode||'auto'} onChange={e=>save({rendererMode:e.target.value})}>
                  <option value="auto">自动识别(推荐,自动探测GPU)</option><option value="gpu">强制 GPU 加速</option><option value="cpu">CPU 软件渲染(兼容)</option>
                </select></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <button style={S.btn('ghost')} onClick={async () => { try { const st = await (window as any).huangquan?.web.rendererStatus(); if (st) alert('渲染状态:\n模式: ' + st.mode + '\nGPU 加速: ' + st.gpuAcceleration + '\nWebGL: ' + st.webgl + '\nCanvas2D: ' + st.canvas2d) } catch {} }}>查看当前渲染状态</button>
                </div>
              </div>
              <div style={S.card}>
                <div style={S.section}>执行控制</div>
                <NumSetting label="工具调用上限" hint="单轮任务最多 LLM 工具调用轮次" value={g.maxToolRounds || 50} min={5} max={200} unit="轮" onChange={v => save({ maxToolRounds: v })} />
                <NumSetting label="失败重试次数" hint="单个工具失败后重试次数（0=不重试）" value={g.retryCount ?? 3} min={0} max={10} unit="次" onChange={v => save({ retryCount: v })} />
                <NumSetting label="工具超时" hint="单工具调用超时阈值" value={g.toolTimeout || 120} min={10} max={600} unit="秒" onChange={v => save({ toolTimeout: v })} />
                <NumSetting label="熔断阈值" hint="同工具+同参数重复调用上限" value={g.meltdownLimit || 3} min={1} max={10} unit="次" onChange={v => save({ meltdownLimit: v })} />
                <Toggle checked={g.parallelTools !== false} onChange={v => save({ parallelTools: v })} label="并行工具执行" hint="读类工具（read/ls/search 等）并发执行，减少等待时间" />
              </div>
              <div style={S.card}>
                <div style={S.section}>上下文管理</div>
                <NumSetting label="压缩触发阈值" hint="Token 用量超过模型上限此比例时触发智能压缩" value={Math.round((g.compactThreshold || 0.7) * 100)} min={30} max={95} unit="%" onChange={v => save({ compactThreshold: v / 100 })} />
              </div>
              <div style={S.card}>
                <div style={S.section}>交互与通知</div>
                <Toggle checked={g.notifyEnabled !== false} onChange={v => save({ notifyEnabled: v })} label="桌面通知" hint="Agent 完成/异常时通过 bridge_notify 推送系统通知" />
                <Toggle checked={g.episodicMemory !== false} onChange={v => save({ episodicMemory: v })} label="情景记忆" hint="自动记录文件操作到审计日志（audit_log 可回溯）" />
                <Toggle checked={g.singleBubble !== false} onChange={v => save({ singleBubble: v })} label="单气泡渲染" hint="整轮任务合并为一条消息（关闭则每步工具调用独立显示气泡）" />
                <NumSetting label="卡片最大高度" hint="show_card 交互卡片的最高像素" value={g.cardMaxHeight || 500} min={100} max={2000} unit="px" onChange={v => save({ cardMaxHeight: v })} />
              </div>
              <div style={S.card}>
                <div style={S.section}>路径与权限</div>
                <div style={S.label}>工作目录</div>
                <div style={S.hint}>Agent 默认读写文件的根目录</div>
                <input style={{ ...S.inp, marginTop: 6 }} value={g.workDir || ''} placeholder="如 D:\桌面\黄泉工作台" onChange={e => save({ workDir: e.target.value })} />
                <div style={{ marginTop: 14 }}><div style={S.label}>文件操作权限</div><div style={S.hint}>控制 Agent 对文件系统的操作范围</div></div>
                <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.filePermission || 'full'} onChange={e => save({ filePermission: e.target.value })}>
                  <option value="full">🔓 完整权限 — 读写执行均可</option>
                  <option value="ask">🔒 操作前询问 — 写/删操作需人工确认</option>
                  <option value="readonly">👁️ 只读 — 仅允许读取，禁止写入/删除/执行</option>
                  <option value="sandbox">📦 工作区沙箱 — 仅限工作目录内操作</option>
                </select>
              </div>
              <div style={S.card}>
                <div style={S.section}>RAG 向量库</div>
                <div style={S.hint}>语义记忆存储配置（import_doc / recall_memory 使用）</div>
                <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
                  <div style={{ flex: 1 }}><div style={S.label}>分块大小</div><input type="number" style={S.inp} value={g.ragChunkSize || 500} min={100} max={2000} onChange={e => save({ ragChunkSize: parseInt(e.target.value) || 500 })} /></div>
                  <div style={{ flex: 1 }}><div style={S.label}>相似度阈值</div><input type="number" style={S.inp} value={Math.round((g.ragThreshold || 0.3) * 100)} min={5} max={95} onChange={e => save({ ragThreshold: (parseInt(e.target.value) || 30) / 100 })} /></div>
                </div>
                <Toggle checked={g.ragAutoSave !== false} onChange={v => save({ ragAutoSave: v })} label="自动保存向量库" hint="每次导入文档后自动持久化到磁盘" />
                <div style={{ textAlign: 'right', marginTop: 8 }}>
                  <button style={S.btn('danger')} onClick={async () => { try { await window.huangquan.memory.clearVector(); alert('向量库已清空') } catch { alert('操作失败') } }}>清空向量库</button>
                </div>
              </div>
              {/* v0.2.3: 权限阈值 L0-L4 未接线(permission.ts 死代码), 已移除 */}
              {/* v0.2.3: 通知详细配置(事件矩阵/免打扰)未实现消费, 已移除 */}
              <div style={S.card}>
                <div style={S.section}>语音 TTS / ASR</div>
                <Toggle checked={g.ttsEnabled === true} onChange={v => save({ ttsEnabled: v })} label="TTS 语音合成" hint="消息下方 🔊 按钮朗读回复（Windows 内置语音引擎, 离线可用）" />
                {/* v0.2.3: ASR 语音识别未实现引擎, 已移除 */}
              <div style={S.card}>
                <div style={S.section}>日志与调试</div>
                <div style={S.label}>日志级别</div>
                <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.logLevel || 'info'} onChange={e => save({ logLevel: e.target.value })}>
                  <option value="debug">🐛 Debug — 全部日志（含工具调用详情）</option>
                  <option value="info">ℹ️ Info — 常规信息（默认）</option>
                  <option value="warn">⚠️ Warn — 仅警告和错误</option>
                  <option value="error">❌ Error — 仅错误</option>
                </select>
                <Toggle checked={g.devTools !== false} onChange={v => save({ devTools: v })} label="开发者工具" hint="启动时自动打开 Electron DevTools" />
              </div>
              <div style={S.card}>
                <div style={S.section}>网络与代理</div>
                <div style={S.label}>代理模式</div>
                <select style={{ ...S.sel, width: '100%' }} value={g.proxyMode || 'none'} onChange={e => save({ proxyMode: e.target.value })}>
                  <option value="system">🔄 使用系统代理</option>
                  <option value="none">🚫 不使用代理</option>
                  <option value="custom">⚙️ 自定义代理</option>
                </select>
                {g.proxyMode === 'custom' && <><input style={{ ...S.inp, marginTop: 8 }} placeholder="http://127.0.0.1:7890" value={g.proxyUrl || ''} onChange={e => save({ proxyUrl: e.target.value })} /><div style={S.hint}>HTTP/HTTPS 代理地址</div></>}
                <div style={S.row}><div style={S.label}>连接超时</div><input type="number" style={S.inp} value={g.connectTimeout || 30} onChange={e => save({ connectTimeout: parseInt(e.target.value) || 30 })} /></div>
              </div>
              {/* v0.2.3: 安全与隐私(闲置锁定/脱敏/审计保留)未实现消费, 已移除 */}
              <div style={S.card}>
                <div style={S.section}>数据管理</div>
                {/* v0.2.6: 工具缓存命中率(总) */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ fontSize: 11, color: C.muted }}>🔧 工具缓存命中率(总)</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#48c98a' }}>{g.stat_cacheRate || '—'} <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>({g.stat_cacheHits || 0} 命中 / {g.stat_cacheMisses || 0} 未中)</span></div>
                </div>

                </div>
                <div style={{ textAlign: 'right', marginBottom: 8 }}>
                  <button style={{ ...S.btn('ghost'), height: 24, fontSize: 9, padding: '0 8px' }} onClick={async () => { try { const s = await window.huangquan.storageStats(); const patch: any = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; const cs = await window.huangquan.cacheStats(); patch['stat_cacheHits'] = cs?.hits || 0; patch['stat_cacheMisses'] = cs?.misses || 0; patch['stat_cacheRate'] = cs?.hit_rate || '0%'; save(patch); showToast('已刷新') } catch { showToast('统计失败') } }}>🔄 刷新</button>
                </div>
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginBottom:10}}>
                  <button style={S.btn('ghost')} onClick={async () => { try { await window.huangquan.cacheClear(); showToast('缓存已清除'); const s = await window.huangquan.storageStats(); const patch: any = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; save(patch) } catch { showToast('清除失败') } }}>清除缓存</button>
                  <button style={S.btn('danger')} onClick={async () => { if (!confirm('确定清空全部对话历史？此操作不可恢复')) return; try { await window.huangquan.sessions.clearAll(); showToast('对话历史已清空'); window.location.reload() } catch { showToast('操作失败') } }}>清除对话历史</button>
                  <button style={S.btn('danger')} onClick={async () => { if (!confirm('恢复出厂设置将重置全部配置（保留对话历史），确定？')) return; try { const ok = await window.huangquan.settings.reset(); showToast(ok ? '已恢复出厂设置，请重启应用' : '操作失败'); } catch { showToast('操作失败') } }}>恢复出厂设置</button>
                  <button style={S.btn('primary')} onClick={async () => { try { const workDir = g.workDir || ''; const path = await window.huangquan.sessions.export(g.exportFormat || 'md', workDir); showToast(path.startsWith('E:') ? path : ('已导出：' + path)) } catch { showToast('导出失败') } }}>📤 导出对话历史</button>
                </div>
                <div style={S.row}><div style={S.label}>导出格式</div><select style={S.sel} value={g.exportFormat||'md'} onChange={e=>save({exportFormat:e.target.value})}><option value="md">Markdown</option><option value="json">JSON</option><option value="txt">纯文本</option></select></div>

                <Toggle checked={g.trayEnabled === true} onChange={v=>save({trayEnabled:v})} label="最小化/关闭时缩至系统托盘" hint="开启后点击最小化或关闭按钮，窗口隐藏到托盘继续运行；从托盘菜单「退出」才真正退出" />
              </div>
              {/* v0.2.3: 快捷键编辑器未绑定真实快捷键, 已移除 */}


              <div style={S.card}>
                <div style={S.section}>关于</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {[['版本','v0.2.3'],['平台','黄泉Agent'],['Electron','32.x'],['React','18.3'],['Node','22.x'],['系统','Windows 10'],['构建',new Date().toLocaleDateString('zh-CN')]].map(([k,v]) => (
                    <div key={k}><div style={S.hint}>{k}</div><div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{v}</div></div>
                  ))}
                </div>
              </div>
            </div> : null}
        </div>
      </div>
      {toast && <div style={{ position:'fixed', bottom:20, left:'50%', transform:'translateX(-50%)', background:C.accent, color:'#fff', padding:'10px 18px', borderRadius:8, fontSize:12, zIndex:9999 }}>{toast}</div>}
    </div>
  )
}
