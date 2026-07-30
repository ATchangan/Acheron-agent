import React, { useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { updateContextLimit } from '../store/chat'

// ─── 各服务商预设参数 ──────────────────────────────────
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
}

const C = {
  bgPage: '#0D0D1A', bgCard: '#15152A', bgInput: '#0F0F22', border: '#2A2D48',
  text: '#E8E8F0', textLabel: '#BBBBD0', textMuted: '#78789A', accent: '#6B4C9A', danger: '#D9464F',
}

const S = {
  card: { background: C.bgCard, border: '1px solid ' + C.border, borderRadius: 8, padding: '20px', marginBottom: 20 },
  cardTitle: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 16 },
  row: { marginBottom: 14 },
  label: { fontSize: 11, color: C.textLabel, marginBottom: 4 },
  inp: { height: 36, background: C.bgInput, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, fontSize: 12, padding: '0 12px', width: '100%', boxSizing: 'border-box' as const, outline: 'none' },
  sel: { height: 36, background: C.bgInput, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, fontSize: 12, padding: '0 10px', outline: 'none', cursor: 'pointer' },
  selSm: { height: 28, background: C.bgInput, border: '1px solid ' + C.border, borderRadius: 5, color: C.text, fontSize: 11, padding: '0 8px', outline: 'none', cursor: 'pointer' },
  btn: (v: string) => ({ height: 32, padding: '0 16px', borderRadius: 6, border: v === 'ghost' ? '1px solid ' + C.border : 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, background: v === 'primary' ? C.accent : v === 'danger' ? C.danger : C.bgInput, color: '#fff', whiteSpace: 'nowrap' as const }),
  hint: { fontSize: 10, color: C.textMuted, marginTop: 4 },
}

const AI_TYPES = ['OpenAI Compatible', 'Azure OpenAI', 'Anthropic Claude', 'Google Gemini']
const GROUPS: Record<string, string[]> = {
  '云平台': ['DeepSeek', 'OpenAI', '通义千问', '智谱', 'Kimi', 'Claude', 'Gemini', 'SiliconFlow'],
  '本地/代理': ['Ollama', 'LM Studio', '自定义'],
}

export default function SettingsView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { providers, general, addProvider, removeProvider, updateProvider } = useSettingsStore()
  const [tab, setTab] = useState('models')
  const [selIdx, setSelIdx] = useState(0)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKey, setNewKey] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newType, setNewType] = useState('OpenAI Compatible')
  const [bgOp, setBgOp] = useState((general as any).bgOpacity ?? 0.7)
  const [hasBg, setHasBg] = useState(!!(general as any).bgImage)
  const [memF, setMemF] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const p = providers[selIdx] || providers[0]

  // 点击左侧服务商名称：自动创建 + 回填预设参数
  const selectProvider = (name: string) => {
    const idx = providers.findIndex(x => x.name === name)
    if (idx >= 0) { setSelIdx(idx); return }
    // 自动创建
    const pre = PRESETS[name] || { type: 'OpenAI Compatible', url: '' }
    const id = 'auto_' + Date.now()
    useSettingsStore.getState().addProvider({
      id, name, type: pre.type, apiKey: '', baseUrl: pre.url,
      models: [], selectedModel: '',
    })
    setSelIdx(providers.length) // 刚加的，索引 = 当前长度
  }

  // 读取模型：调用厂商 models 接口
  const fetchModels = async () => {
    if (!p || !p.baseUrl) return
    setLoading(true)
    try {
      const models = await window.huangquan.models.detect(p.baseUrl, p.apiKey)
      if (models.length) updateProvider(p.id, { models, selectedModel: models[0] })
      else alert('未获取到模型列表，请检查 API Key 和 Base URL')
    } catch { alert('请求失败，请检查网络或地址') }
    setLoading(false)
  }

  const renderModels = () => {
    if (!p) return <div style={{ color: C.textMuted, fontSize: 12, padding: 40, textAlign: 'center' }}>选择左侧服务商</div>
    return <div style={{ flex: 1, paddingLeft: 24, overflowY: 'auto' }}>
      {/* Card 1 */}
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={S.cardTitle}>服务基础配置</span>
          <button style={S.btn('danger')} onClick={() => removeProvider(p.id)}>删除供应商</button>
        </div>
        <div style={S.row}>
          <div style={S.label}>API Key{PRESETS[p.name]?.noKey ? '（本地服务无需填写）' : ''}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={S.inp} type="password" value={p.apiKey || ''} placeholder={PRESETS[p.name]?.noKey ? '本地服务无需密钥' : 'sk-...'} onChange={e => updateProvider(p.id, { apiKey: e.target.value })} />
            <button style={S.btn('ghost')} onClick={() => { const el = document.querySelector('input[type=password]') as HTMLInputElement; if (el) el.type = el.type === 'password' ? 'text' : 'password' }}>👁</button>
          </div>
        </div>
        <div style={S.row}>
          <div style={S.label}>Headers（一行一组，key=value）</div>
          <textarea style={{ ...S.inp, height: 48, resize: 'vertical', padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }} placeholder="X-Custom-Header=value" value={(p as any).headers || ''} onChange={e => updateProvider(p.id, { headers: e.target.value } as any)} />
        </div>
        <div style={S.row}>
          <div style={S.label}>Base URL</div>
          <input style={S.inp} value={p.baseUrl || ''} onChange={e => updateProvider(p.id, { baseUrl: e.target.value })} />
        </div>
        <div style={{ ...S.row, marginBottom: 0 }}>
          <div style={S.label}>API 类型</div>
          <select style={S.sel} value={p.type || 'OpenAI Compatible'} onChange={e => updateProvider(p.id, { type: e.target.value })}>
            {AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Card 2 */}
      <div style={S.card}>
        <div style={S.cardTitle}>已添加模型</div>
        {p.models.length === 0 ? <div style={{ color: C.textMuted, fontSize: 11, padding: '12px 0' }}>暂无模型，请点击「读取模型」从接口拉取</div> :
          p.models.map((m: string, i: number) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 12, color: C.text }}>{m}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <select style={S.selSm} value={p.selectedModel === m ? m : p.selectedModel || p.models[0]}
                  onChange={e => { updateProvider(p.id, { selectedModel: e.target.value }); updateContextLimit(e.target.value) }}>
                  {p.models.map((x: string) => <option key={x} value={x}>{x}</option>)}
                </select>
                <button style={{ ...S.btn('ghost'), height: 28, padding: '0 6px', fontSize: 10 }} onClick={() => {
                  updateProvider(p.id, { models: p.models.filter((_, j) => j !== i) } as any)
                }}>×</button>
              </div>
            </div>
          ))}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button style={S.btn('primary')} onClick={() => { const id = prompt('模型 ID：'); if (id) updateProvider(p.id, { models: [...p.models, id] } as any) }}>添加模型</button>
          <button style={S.btn('ghost')} disabled={loading} onClick={fetchModels}>{loading ? '读取中...' : '读取模型'}</button>
        </div>
      </div>

      {/* Card 3 */}
      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={S.cardTitle}>任务调度绑定</div>
        <div style={S.row}>
          <div style={S.label}>小工具模型</div>
          <select style={S.sel} value={(p as any).smallModel || ''} onChange={e => updateProvider(p.id, { smallModel: e.target.value } as any)}>
            <option value="">未指定（复用默认模型）</option>
            {p.models.map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={S.hint}>轻量化问答、文本总结等低负载任务</div>
        </div>
        <div style={{ ...S.row, marginBottom: 0 }}>
          <div style={S.label}>大工具模型</div>
          <select style={S.sel} value={(p as any).largeModel || ''} onChange={e => updateProvider(p.id, { largeModel: e.target.value } as any)}>
            <option value="">未指定（复用默认模型）</option>
            {p.models.map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
          <div style={S.hint}>文件解析、代码运行、多轮复杂工具调用任务</div>
        </div>
      </div>
    </div>
  }

  const renderMemory = () => (
    <div style={{ flex: 1, paddingLeft: 24, overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.cardTitle}>置顶记忆</div>
        <input style={{ ...S.inp, marginBottom: 12 }} placeholder="添加置顶事实，按 Enter 确认" onKeyDown={async e => {
          if (e.key !== 'Enter') return; const v = (e.target as HTMLInputElement).value; if (!v) return
          const m = await window.huangquan.memory.load(); (m as any).pinnedFacts = [...((m as any).pinnedFacts || []), v]
          await window.huangquan.memory.save(m); setMemF([...(m as any).pinnedFacts || []]); (e.target as HTMLInputElement).value = ''
        }} />
        {memF.length === 0 ? <div style={{ color: C.textMuted, fontSize: 11, textAlign: 'center' }}>暂无</div> :
          memF.map((f, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 10px', background: C.bgInput, borderRadius: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{f}</span>
            <button style={S.btn('danger')} onClick={async () => { const m = await window.huangquan.memory.load(); (m as any).pinnedFacts.splice(i, 1); await window.huangquan.memory.save(m); setMemF([...(m as any).pinnedFacts || []]) }}>删除</button>
          </div>)}
      </div>
    </div>
  )

  const TABS = [{ key: 'models', icon: '🔑', label: '供应商' }, { key: 'persona', icon: '🎭', label: '人设' }, { key: 'memory', icon: '🧠', label: '记忆' }, { key: 'skin', icon: '🎨', label: '皮肤' }]
  const [chatPersona, setChatPersona] = useState((general as any).chatPersona || '')
  const [workPersona, setWorkPersona] = useState((general as any).workPersona || '')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: C.bgPage }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid ' + C.border, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button style={{ background: 'none', border: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 15 }} onClick={() => onNavigate('chat')}>←</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>设置</span>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ width: 130, borderRight: '1px solid ' + C.border, padding: '12px 8px', overflowY: 'auto' }}>
          {TABS.map(t => <div key={t.key} onClick={() => setTab(t.key)} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, marginBottom: 3, color: tab === t.key ? C.accent : C.text, background: tab === t.key ? 'rgba(107,76,154,0.1)' : 'transparent', display: 'flex', alignItems: 'center', gap: 7 }}><span>{t.icon}</span><span>{t.label}</span></div>)}
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {tab === 'models' ? <>
            <div style={{ display: 'flex', height: '100%', gap: 0 }}>
              <div style={{ width: 160, borderRight: '1px solid ' + C.border, padding: '12px 10px', overflowY: 'auto' }}>
                {Object.entries(GROUPS).map(([g, names]) => (<div key={g} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6, paddingLeft: 4 }}>{g}</div>
                  {names.map(n => { const pi = providers.findIndex(x => x.name === n); const active = pi >= 0 && pi === selIdx
                    return <div key={n} onClick={() => selectProvider(n)} style={{ padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 11, color: active ? C.accent : C.text, background: active ? 'rgba(107,76,154,0.12)' : 'transparent', marginBottom: 3 }}>{n}</div> })}</div>))}
                <button style={{ ...S.btn('primary'), width: '100%', marginTop: 8 }} onClick={() => setShowNew(true)}>+ 自定义</button>
              </div>
              <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>{renderModels()}</div>
            </div>
            {showNew ? <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
              <div style={{ ...S.card, width: 380 }}>
                <div style={S.cardTitle}>自定义供应商</div>
                <input style={{ ...S.inp, marginBottom: 12 }} placeholder="名称" value={newName} onChange={e => setNewName(e.target.value)} />
                <input style={{ ...S.inp, marginBottom: 12 }} placeholder="API Key（可选）" value={newKey} onChange={e => setNewKey(e.target.value)} />
                <input style={{ ...S.inp, marginBottom: 12 }} placeholder="Base URL" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
                <select style={{ ...S.sel, marginBottom: 12, width: '100%' }} value={newType} onChange={e => setNewType(e.target.value)}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button style={S.btn('ghost')} onClick={() => setShowNew(false)}>取消</button>
                  <button style={S.btn('primary')} onClick={() => { if (!newName) return; useSettingsStore.getState().addProvider({ id: 'custom_' + Date.now(), name: newName, type: newType, apiKey: newKey, baseUrl: newUrl, models: [], selectedModel: '' }); setShowNew(false) }}>保存</button>
                </div>
              </div>
            </div> : null}
          </> : tab === 'persona' ? <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.cardTitle}>聊天人设</div>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8 }}>控制聊天模式下 Agent 的语气和风格。留空使用默认黄泉人设。</div>
                <textarea style={{ ...S.inp, height: 120, resize: 'vertical', padding: '10px 12px', fontSize: 11, lineHeight: 1.6 }} value={chatPersona} onChange={e => { setChatPersona(e.target.value); useSettingsStore.setState(s => ({ general: { ...s.general, chatPersona: e.target.value } })); useSettingsStore.getState().save() }} placeholder="淡漠寡言，克制优雅。短句优先，不用感叹号..." />
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>工作人设</div>
                <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 8 }}>控制工作模式下 Agent 的行为准则。留空使用默认高效执行人设。</div>
                <textarea style={{ ...S.inp, height: 120, resize: 'vertical', padding: '10px 12px', fontSize: 11, lineHeight: 1.6, fontFamily: 'monospace' }} value={workPersona} onChange={e => { setWorkPersona(e.target.value); useSettingsStore.setState(s => ({ general: { ...s.general, workPersona: e.target.value } })); useSettingsStore.getState().save() }} placeholder="高效执行。禁止碎片回复。完成只输出一条整合结果..." />
              </div>
            </div> : tab === 'memory' ? renderMemory() :
            tab === 'skin' ? <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
              <div style={S.card}>
                <div style={S.cardTitle}>背景图片</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} id="bgImg" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { useSettingsStore.getState().setBgImage(r.result as string); setHasBg(true) }; r.readAsDataURL(f) }} />
                  <button style={S.btn('primary')} onClick={() => document.getElementById('bgImg')?.click()}>选择图片</button>
                  {hasBg ? <button style={S.btn('danger')} onClick={() => { useSettingsStore.getState().setBgImage(null); setHasBg(false) }}>清除</button> : null}
                </div>
                {hasBg ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <span style={{ fontSize: 11, color: C.textLabel }}>可见度</span>
                  <input type="range" min="5" max="100" value={Math.round(bgOp * 100)} onChange={e => { const v = parseInt(e.target.value) / 100; setBgOp(v); useSettingsStore.getState().setBgOpacity(v) }} style={{ flex: 1 }} />
                  <span style={{ fontSize: 11, color: C.text }}>{Math.round(bgOp * 100)}%</span>
                </div> : null}
              </div>
            </div> : null
          }
        </div>
      </div>
    </div>
  )
}