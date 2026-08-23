// KeysView.tsx —— v0.4.2  API Keys 管理页：服务商密钥脱敏展示/复制/删除 + 新增
import { useState } from 'react'
import { KeyRound, Eye, EyeOff, Copy, Check, Trash2, Plus, X } from 'lucide-react'
import { useSettingsStore } from '../store/settings'

const mask = (k: string) => (k.length <= 8 ? '••••' : k.slice(0, 4) + '••••••••' + k.slice(-4))

export default function KeysView() {
  const providers = useSettingsStore(s => s.providers)
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const addProvider = useSettingsStore(s => s.addProvider)
  const removeProvider = useSettingsStore(s => s.removeProvider)
  const removeMediaProvider = useSettingsStore(s => s.removeMediaProvider)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', apiKey: '', baseUrl: '', models: '' })
  const [msg, setMsg] = useState('')
  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2200) }

  const copy = async (key: string, id: string) => {
    try { await navigator.clipboard.writeText(key) } catch { /* 忽略 */ }
    setCopied(id)
    setTimeout(() => setCopied(''), 1500)
  }

  const create = () => {
    if (!form.name.trim() || !form.apiKey.trim()) return
    addProvider({
      id: 'p_' + Date.now().toString(36),
      name: form.name.trim(),
      type: 'openai',
      apiKey: form.apiKey.trim(),
      baseUrl: form.baseUrl.trim() || undefined,
      models: form.models.split(/[,，\s]+/).filter(Boolean),
    })
    setForm({ name: '', apiKey: '', baseUrl: '', models: '' })
    setAdding(false)
    toast('已添加服务商 ' + form.name.trim())
  }

  const rows = [
    ...providers.map(p => ({ kind: 'text', id: p.id, name: p.name, key: p.apiKey || '', detail: p.models.join(' / ') || p.baseUrl || '' })),
    ...mediaProviders.map(p => ({ kind: 'media', id: p.id, name: p.name, key: p.apiKey || '', detail: p.type || '' })),
  ]

  return (
    <div className="hq-keys">
      <div className="hq-page-head">
        <h2 className="hq-page-title"><KeyRound size={16} /> API Keys</h2>
        <span className="hq-page-subtitle">模型服务商与密钥管理（密钥脱敏展示）</span>
        <span className="hq-page-spacer" />
        <button type="button" className="hq-btn" onClick={() => setAdding(v => !v)}><Plus size={13} /> 新增服务商</button>
      </div>

      {adding && (
        <div className="hq-keys-form">
          <input placeholder="服务商名称（如 DeepSeek）" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input placeholder="API Key" value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })} />
          <input placeholder="Base URL（可选）" value={form.baseUrl} onChange={e => setForm({ ...form, baseUrl: e.target.value })} />
          <input placeholder="模型列表，逗号分隔（可选）" value={form.models} onChange={e => setForm({ ...form, models: e.target.value })} />
          <button type="button" className="hq-btn hq-btn-accent" onClick={create}>保存</button>
          <button type="button" className="hq-btn" onClick={() => setAdding(false)}><X size={13} /> 取消</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="hq-profiles-empty" style={{ minHeight: 240 }}>
          <KeyRound size={34} className="hq-profiles-empty-icon" />
          <p className="hq-profiles-empty-title">还没有配置服务商</p>
          <p className="hq-profiles-empty-desc">在设置 → 供应商中配置模型服务，或在右侧直接新增服务商与密钥。</p>
        </div>
      ) : (
        <div className="hq-keys-list">
          {rows.map(r => (
            <div key={r.kind + r.id} className="hq-keys-row">
              <span className="hq-keys-kind">{r.kind === 'media' ? '媒体' : '模型'}</span>
              <div className="hq-keys-main">
                <span className="hq-keys-name">{r.name}</span>
                <span className="hq-keys-detail">{r.detail}</span>
              </div>
              <span className="hq-keys-key">{revealed[r.id] ? r.key : (r.key ? mask(r.key) : '（未配置密钥）')}</span>
              <div className="hq-keys-actions">
                {r.key && (
                  <button type="button" className="hq-icon-btn" title={revealed[r.id] ? '隐藏密钥' : '显示密钥'} aria-label="显示或隐藏密钥" onClick={() => setRevealed(prev => ({ ...prev, [r.id]: !prev[r.id] }))}>
                    {revealed[r.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                )}
                {r.key && (
                  <button type="button" className="hq-icon-btn" title="复制密钥" aria-label="复制密钥" onClick={() => void copy(r.key, r.id)}>
                    {copied === r.id ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                )}
                <button type="button" className="hq-icon-btn danger" title="删除服务商" aria-label="删除服务商" onClick={() => { if (r.kind === 'media') removeMediaProvider(r.id); else removeProvider(r.id) }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {msg && <div className="hq-toast hq-profiles-toast">{msg}</div>}
    </div>
  )
}
