import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'
import MediaForm from './MediaForm'
import type { MediaProvider, ProviderConfig } from '../../global'

// v0.3.1 块 H: 供应商 tab(从 SettingsView 拆分, 行为零变化)

export const AI_TYPES = ['OpenAI Compatible', 'Azure OpenAI', 'Anthropic Claude', 'Google Gemini']
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
const GROUPS: Record<string, string[]> = {
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
    if (/gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava|yi-vision|internvl|识图|多模态/.test(ml)) caps.add('多模态')
    if (/(dall|flux|sdxl|seedream|cogview|imagen|midjourney|文生图|图片生成|image-gen|text2img)/.test(ml)) caps.add('图片')
    if (/(sora|kling|runway|pika|veo|video-gen|文生视频)/.test(ml)) caps.add('视频')
    if (/(whisper|tts|audio|speech|voice|语音|识别)/.test(ml)) caps.add('语音')
  }
  if (!caps.size) caps.add('文字')
  return [...caps]
}

// 媒体平台配置表单(供应商页内联显示, 不跳转) —— 样式与供应商表单对齐(DeepSeek 模板)
export default function ModelsTab(props: { showToast: (msg: string) => void }) {
  const { showToast } = props
  const providers = useSettingsStore(s => s.providers || [])
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const updateProvider = useSettingsStore(s => s.updateProvider)
  const removeProvider = useSettingsStore(s => s.removeProvider)
  const addProvider = useSettingsStore(s => s.addProvider)
  const addMediaProvider = useSettingsStore(s => s.addMediaProvider)
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [selIdx, setSelIdx] = useState(-1)
  const [mediaSelIdx, setMediaSelIdx] = useState(-1)
  const p = providers[selIdx] || null
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState(''); const [newKey, setNewKey] = useState(''); const [newUrl, setNewUrl] = useState(''); const [newType, setNewType] = useState('OpenAI Compatible')
  const [modelInput, setModelInput] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [testState, setTestState] = useState<{ key: string; loading: boolean; ok?: boolean; msg?: string }>({ key: '', loading: false })
  const [visionPrompt, setVisionPrompt] = useState(false)
  const [visionPick, setVisionPick] = useState('')
  const testConnection = async (key: string, baseUrl?: string, apiKey?: string, isAnthropic?: boolean) => {
    setTestState({ key, loading: true })
    const r = await window.huangquan.models.test(baseUrl || '', apiKey || '', { anthropic: isAnthropic })
    setTestState({ key, loading: false, ok: r.ok, msg: r.message || (r.ok ? '连接成功' : '连接失败') })
  }
  const fetchModels = async () => {
    if (!p) return
    if (!p.baseUrl) { showToast('请先填写 Base URL'); return }
    setLoading(true)
    try {
      const r = await window.huangquan.models.detect(p.baseUrl, p.apiKey || '', { type: p.type, anthropic: p.type === 'Anthropic Claude' })
      if (!r.ok) { showToast(r.error || '读取失败'); return }
      const items = (r.models || []).map((m: string) => ({ model: m, caps: detectCaps([m]) }))
      setDetectModal({ providerId: p.id, items })
      setDetectSel([])
    } catch (e) { showToast('读取异常: ' + String(e)) } finally { setLoading(false) }
  }
  const selectProvider = (name: string) => {
    useSettingsStore.getState().save()
    setMediaSelIdx(-1)
    const idx = providers.findIndex(x => x.name === name)
    setSelIdx(idx)
    // v0.3.0: 自动加载默认 BaseURL/API 类型(仅空字段, 用户自定义优先)
    const pre = PRESETS[name]
    const prov = providers[idx]
    if (prov && pre) {
      const patch: Partial<ProviderConfig> = {}
      if (!prov.baseUrl && pre.url) patch.baseUrl = pre.url
      if (!prov.type && pre.type) patch.type = pre.type
      if (Object.keys(patch).length) updateProvider(prov.id, patch)
    }
  }
  const [detectModal, setDetectModal] = useState<{ providerId: string; items: { model: string; caps: string[] }[] } | null>(null)
  const [detectSel, setDetectSel] = useState<string[]>([])
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 160, borderRight: '1px solid ' + C.border, padding: '14px 10px', overflowY: 'auto' }}>
        {(() => {
          const allNames = Object.values(GROUPS).flat()
          const allMediaNames = Object.keys(MEDIA_PRESETS)
          const capOrder = ['多模态', '文字', '图片', '视频', '语音']
          const cfgProvs = providers.filter(pp => !!pp.apiKey)
          const cfgMedias = mediaProviders.filter(mp => !!mp.apiKey)
          const capsOf = (kind: 'provider' | 'media', item: ProviderConfig | MediaProvider): string[] => {
            const models = kind === 'provider' ? ('models' in item ? (item.models || []) : []) : [...((item as MediaProvider).imgModels || []), ...((item as MediaProvider).videoModels || []), ...((item as MediaProvider).audioModels || [])]
            return detectCaps(models)
          }
          const mainCap = (caps: string[]) => capOrder.find(c => caps.includes(c)) || '文字'
          const row = (name: string, kind: 'provider' | 'media', cfg: boolean, caps: string[]) => {
            const active = kind === 'provider' ? (providers.findIndex(x => x.name === name) === selIdx && cfg) : (mediaProviders.findIndex(x => x.name === name) === mediaSelIdx && cfg)
            return <div key={kind + '::' + name} onClick={() => {
              if (kind === 'provider') selectProvider(name)
              else {
                useSettingsStore.getState().save()
                setSelIdx(-1)
                const existing = mediaProviders.find(m => m.name === name)
                if (existing) {
                  const pre = MEDIA_PRESETS[name]
                  if (pre && !existing.baseUrl && pre.url) useSettingsStore.getState().updateMediaProvider(existing.id, { baseUrl: pre.url })
                  setMediaSelIdx(mediaProviders.indexOf(existing))
                }
                else { const pre = MEDIA_PRESETS[name]; if (pre) { const np = { id: 'media_' + Date.now(), name, type: pre.type, baseUrl: pre.url, imgModels: [] as string[], videoModels: [] as string[], audioModels: [] as string[] }; addMediaProvider(np); setMediaSelIdx(mediaProviders.length) } }
              }
            }} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)', color: active ? C.accent : C.text, background: active ? C.accentBg : 'transparent', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <span style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{cfg ? caps.slice(0, 3).map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: CAP_COLORS[c] || C.text, background: 'rgba(150,150,160,0.13)', padding: '1px 5px', borderRadius: 8 }}>{c}</span>) : <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted, background: 'rgba(150,150,160,0.13)', padding: '1px 6px', borderRadius: 8 }}>未配置</span>}</span>
            </div>
          }
          const groupTitle = (txt: string) => <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 4, marginTop: 10 }}>{txt}</div>
          const subTitle = (txt: string) => <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.accent, fontWeight: 600, margin: '8px 0 4px', paddingLeft: 4 }}>{txt}</div>
          const cfgByName = new Map<string, { name: string; kind: 'provider' | 'media'; caps: string[] }>()
          cfgProvs.forEach(pp => cfgByName.set(pp.name, { name: pp.name, kind: 'provider', caps: capsOf('provider', pp) }))
          cfgMedias.forEach(mp => {
            const existing = cfgByName.get(mp.name)
            const mcaps = capsOf('media', mp)
            if (existing) existing.caps = [...new Set([...existing.caps, ...mcaps])]
            else cfgByName.set(mp.name, { name: mp.name, kind: 'media', caps: mcaps })
          })
          const cfgItems = [...cfgByName.values()]
          const customUncfg = providers.filter(pp => !allNames.includes(pp.name) && !pp.apiKey).map(pp => pp.name)
          const uncfgNames = [...new Set([
            ...allNames.filter(n => n !== '自定义' && !providers.some(pp => pp.name === n && pp.apiKey)),
            ...allMediaNames.filter(n => !mediaProviders.some(mp => mp.name === n && mp.apiKey)),
            ...customUncfg,
          ])]
          return (
            <>
              {groupTitle('已配置')}
              {cfgItems.length === 0 && <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '4px 10px 8px' }}>暂无已配置平台（填好 API Key 后自动分类置顶）</div>}
              {capOrder.map(g => cfgItems.filter(x => mainCap(x.caps) === g).length > 0 && (
                <div key={g}>
                  {subTitle(g)}
                  {cfgItems.filter(x => mainCap(x.caps) === g).map(x => row(x.name, x.kind, true, x.caps))}
                </div>
              ))}
              {groupTitle('未配置')}
              {uncfgNames.map(n => {
                const kind = providers.some(pp => pp.name === n) ? 'provider' : mediaProviders.some(mp => mp.name === n) ? 'media' : (allNames.includes(n) ? 'provider' : 'media')
                return row(n, kind, false, [])
              })}
              <button style={{ ...S.btn('primary'), width: '100%', marginTop: 6 }} onClick={() => setShowNew(true)}>+ 自定义</button>
            </>
          )
        })()}
      </div>
      <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
        {mediaSelIdx >= 0 ? <MediaForm mediaSelIdx={mediaSelIdx} showToast={showToast} /> : !p ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)', padding: 40, textAlign: 'center' }}>选择左侧供应商</div> : <>
          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <span style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text }}>服务配置</span>
              <button style={S.btn('danger')} onClick={() => removeProvider(p.id)}>删除</button>
            </div>
            <div style={S.row}><div style={S.label}>API Key{PRESETS[p.name]?.noKey ? '（本地服务无需）' : ''}</div>
              <input style={S.inp} type="password" value={p.apiKey || ''} placeholder={PRESETS[p.name]?.noKey ? '本地服务无需密钥' : 'sk-...'} onChange={e => updateProvider(p.id, { apiKey: e.target.value })} /></div>
            <div style={S.row}><div style={S.label}>Base URL</div><input style={S.inp} value={p.baseUrl || ''} onChange={e => updateProvider(p.id, { baseUrl: e.target.value })} /></div>
            <div style={S.row}><div style={S.label}>API 类型</div><select style={S.sel} value={p.type || 'OpenAI Compatible'} onChange={e => updateProvider(p.id, { type: e.target.value })}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>Headers</div><textarea style={{ ...S.inp, height: 44, resize: 'vertical', padding: '8px 12px', fontFamily: 'monospace', fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="key=value" value={p.headers || ''} onChange={e => updateProvider(p.id, { headers: e.target.value })} /></div>
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text, marginBottom: 14 }}>模型列表</div>
            {p.models.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '12px 0' }}>暂无，点击"读取模型"从接口获取</div> : p.models.map((m: string, i: number) => {
              const caps = detectCaps([m])
              return <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                  {caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}
                </span>
                <button style={{ ...S.btn('ghost'), height: 28, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)', flexShrink: 0 }} onClick={() => updateProvider(p.id, { models: p.models.filter((_, j) => j !== i) })}>×</button>
              </div>
            })}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, alignItems: 'center' }}>
              {modelInput !== null ? <>
                <input style={{ ...S.inp, width: 200, height: 30, fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="模型 ID..." value={modelInput} onChange={e => setModelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && modelInput.trim()) { updateProvider(p.id, { models: [...p.models, modelInput.trim()] }); setModelInput(null) } }} autoFocus />
                <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (modelInput.trim()) { updateProvider(p.id, { models: [...p.models, modelInput.trim()] }); setModelInput(null) } }}>确认</button>
                <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setModelInput(null)}>取消</button>
              </> : <button style={S.btn('primary')} onClick={() => setModelInput('')}>添加模型</button>}
              <button style={S.btn('ghost')} disabled={loading} onClick={fetchModels}>{loading ? '读取中...' : '读取模型'}</button>
              <button style={S.btn('ghost')} disabled={testState.loading} onClick={() => testConnection('provider:' + p.id, p.baseUrl, p.apiKey, p.type === 'Anthropic Claude')}>{testState.loading && testState.key === 'provider:' + p.id ? '测试中...' : '测试连接'}</button>
              {testState.key === 'provider:' + p.id && testState.msg && (
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: testState.ok ? 'var(--success)' : 'var(--danger)', marginLeft: 4 }}>{testState.msg}</span>
              )}
            </div>
          </div>
          <div style={{ ...S.card, marginBottom: 0 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: C.accent, padding: '2px 0' }}>调度绑定已移至「策略」页 — 所有模型公用</div>
          </div>
        </>}
      </div>
      {showNew ? <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setShowNew(false)}>
        <div style={{ ...S.card, width: 380, padding: 24 }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 18 }}>自定义供应商</div>
          <input style={{ ...S.inp, marginBottom: 10 }} placeholder="名称" value={newName} onChange={e => setNewName(e.target.value)} />
          <input style={{ ...S.inp, marginBottom: 10 }} placeholder="API Key" value={newKey} onChange={e => setNewKey(e.target.value)} />
          <input style={{ ...S.inp, marginBottom: 10 }} placeholder="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
          <select style={{ ...S.sel, marginBottom: 14, width: '100%' }} value={newType} onChange={e => setNewType(e.target.value)}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button style={S.btn('ghost')} onClick={() => setShowNew(false)}>取消</button><button style={S.btn('primary')} onClick={() => { if (!newName) return; addProvider({ id: 'custom_' + Date.now(), name: newName, type: newType, apiKey: newKey, baseUrl: newUrl, models: [], selectedModel: '' }); setShowNew(false) }}>保存</button></div>
        </div>
      </div> : null}
      {visionPrompt ? <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setVisionPrompt(false)}>
        <div style={{ ...S.card, width: 420, padding: 24 }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 8 }}>该供应商无视觉模型</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginBottom: 16 }}>当前供应商的模型仅支持文字。如需分析图片，请从其他已配置的供应商中选择一个视觉辅助模型：</div>
          <select style={{ ...S.sel, width: '100%', marginBottom: 14 }} value={visionPick} onChange={e => setVisionPick(e.target.value)}>
            <option value="">— 选择视觉辅助模型 —</option>
            {providers.filter(pr => pr.id !== p?.id && (pr.models || []).some((m: string) => /gpt-4o|claude-3|gemini|vision|vl|vlm|qwen-vl|glm-4v|llava/i.test(m.toLowerCase()))).map(pr => (
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
      {detectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setDetectModal(null)}>
          <div style={{ ...S.card, width: 480, maxHeight: '72vh', display: 'flex', flexDirection: 'column', padding: 24 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 4 }}>选择要添加的模型</div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, marginBottom: 12 }}>已从接口读取 {detectModal.items.length} 个模型，勾选后点击「添加所选」才能使用</div>
            <div style={{ flex: 1, overflowY: 'auto', marginBottom: 14 }}>
              {['多模态', '文字', '图片', '视频', '语音'].filter(g => detectModal.items.some(x => x.caps[0] === g)).map(g => (
                <div key={g}>
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', fontWeight: 700, color: CAP_COLORS[g] || C.text, margin: '8px 0 4px' }}>{g}</div>
                  {detectModal.items.filter(x => x.caps[0] === g).map(x => (
                    <label key={x.model} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
                      <input type="checkbox" checked={detectSel.includes(x.model)} onChange={e => { setDetectSel(prev => e.target.checked ? [...prev, x.model] : prev.filter(m => m !== x.model)) }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.model}</span>
                      <span style={{ display: 'flex', gap: 3, flexShrink: 0 }}>{x.caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button style={S.btn('ghost')} onClick={() => setDetectModal(null)}>取消</button>
              <button style={S.btn('primary')} disabled={!detectSel.length} onClick={() => {
                const cur = providers.find(pp => pp.id === detectModal.providerId)
                if (cur) updateProvider(cur.id, { models: [...new Set([...(cur.models || []), ...detectSel])] })
                setDetectModal(null); setDetectSel([])
              }}>添加所选 ({detectSel.length})</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
