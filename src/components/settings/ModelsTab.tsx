import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'
import MediaForm from './MediaForm'
import { AI_TYPES, PRESETS, GROUPS, MEDIA_PRESETS, CAP_COLORS, detectCaps } from './consts'
import type { MediaProvider, ProviderConfig } from '../../global'
import { U } from '../ui-styles'


// v0.3.1 块 H: 供应商 tab(从 SettingsView 拆分, 行为零变化)


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
    if (!p.baseUrl) { showToast('请先填写接口地址'); return }
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
    let idx = providers.findIndex(x => x.name === name)
    // 未配置过的供应商: 自动创建条目(预填 PRESETS 默认 baseUrl/type), 让用户直接填 Key 即可应用
    if (idx < 0) {
      const pre = PRESETS[name]
      const np: ProviderConfig = { id: 'auto_' + Date.now(), name, type: pre?.type || 'OpenAI Compatible', apiKey: '', baseUrl: pre?.url || '', models: [], selectedModel: '' }
      useSettingsStore.getState().addProvider(np)
      idx = useSettingsStore.getState().providers.findIndex(x => x.name === name)
    }
    setSelIdx(idx)
    // v0.3.0: 自动加载默认 BaseURL/API 类型(仅空字段, 用户自定义优先)
    const pre = PRESETS[name]
    const prov = useSettingsStore.getState().providers[idx]
    if (prov && pre) {
      const patch: Partial<ProviderConfig> = {}
      if (!prov.baseUrl && pre.url) patch.baseUrl = pre.url
      if (!prov.type && pre.type) patch.type = pre.type
      if (Object.keys(patch).length) updateProvider(prov.id, patch)
    }
  }
  const [detectModal, setDetectModal] = useState<{ providerId: string; items: { model: string; caps: string[] }[] } | null>(null)
  const [detectSel, setDetectSel] = useState<string[]>([])
  // 有密钥但还没有任何模型时，自动读取一次（新填密钥或打开已有配置都会触发；失败可手动点「读取模型」重试）
  const autoFired = React.useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!p || !p.baseUrl || !p.apiKey || (p.models && p.models.length > 0)) return
    if (autoFired.current.has(p.id)) return
    autoFired.current.add(p.id)
    const t = setTimeout(async () => {
      try {
        const base = p.baseUrl || ''
        const key = p.apiKey || ''
        const r = await window.huangquan.models.detect(base, key, { type: p.type, anthropic: p.type === 'Anthropic Claude' })
        if (r.ok && r.models && r.models.length > 0) {
          const items = r.models.map((m: string) => ({ model: m, caps: detectCaps([m]) }))
          setDetectModal({ providerId: p.id, items })
          setDetectSel([])
        }
      } catch { /* 静默失败，用户可手动重试 */ }
    }, 900)
    return () => clearTimeout(t)
  }, [p?.id, p?.apiKey, p?.baseUrl, p?.models?.length])
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 160, borderRight: '1px solid ' + C.border, padding: '14px 10px', overflowY: 'auto' }}>
        {(() => {
          const allNames = Object.values(GROUPS).flat()
          const allMediaNames = Object.keys(MEDIA_PRESETS)
          const capOrder = ['多模态', '文字', '图片', '视频']
          const cfgProvs = providers.filter(pp => !!pp.apiKey)
          const cfgMedias = mediaProviders.filter(mp => !!mp.apiKey)
          const capsOf = (kind: 'provider' | 'media', item: ProviderConfig | MediaProvider): string[] => {
            const models = kind === 'provider' ? ('models' in item ? (item.models || []) : []) : [...((item as MediaProvider).imgModels || []), ...((item as MediaProvider).videoModels || [])]
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
                else { const pre = MEDIA_PRESETS[name]; if (pre) { const np = { id: 'media_' + Date.now(), name, type: pre.type, baseUrl: pre.url, imgModels: [] as string[], videoModels: [] as string[] }; addMediaProvider(np); setMediaSelIdx(mediaProviders.length) } }
              }
            }} style={{ padding: '7px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)', color: active ? C.accent : C.text, background: active ? C.accentBg : 'transparent', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
              <span style={U.ellipsis}>{name}</span>
              <span style={{ display: 'flex', gap: 3, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{cfg ? caps.slice(0, 3).map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: CAP_COLORS[c] || C.text, background: 'rgba(150,150,160,0.13)', padding: '1px 5px', borderRadius: 8 }}>{c}</span>) : <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted, background: 'rgba(150,150,160,0.13)', padding: '1px 6px', borderRadius: 8 }}>未设置</span>}</span>
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
              {cfgItems.length === 0 && <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, padding: '4px 10px 8px' }}>暂无已配置平台（填好密钥后自动分类置顶）</div>}
              {capOrder.map(g => cfgItems.filter(x => mainCap(x.caps) === g).length > 0 && (
                <div key={g}>
                  {subTitle(g)}
                  {cfgItems.filter(x => mainCap(x.caps) === g).map(x => row(x.name, x.kind, true, x.caps))}
                </div>
              ))}
              {groupTitle('未设置')}
              {uncfgNames.map(n => {
                const kind = providers.some(pp => pp.name === n) ? 'provider' : mediaProviders.some(mp => mp.name === n) ? 'media' : (allNames.includes(n) ? 'provider' : 'media')
                return row(n, kind, false, [])
              })}
              <button style={{ ...S.btn('primary'), width: '100%', marginTop: 6 }} onClick={() => setShowNew(true)}>+ 自定义</button>
            </>
          )
        })()}
      </div>
      <div style={U.pageBody}>
        {mediaSelIdx >= 0 ? <MediaForm mediaSelIdx={mediaSelIdx} showToast={showToast} /> : !p ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 1px)', padding: 40, textAlign: 'center' }}>从左侧选择一个供应商开始配置</div> : <>
          <div style={S.card}>
            <div style={U.betweenMb18}>
              <span style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text }}>服务配置</span>
              <button style={S.btn('danger')} onClick={() => removeProvider(p.id)}>删除</button>
            </div>
            <div style={S.row}><div style={S.label}>密钥（API Key）{PRESETS[p.name]?.noKey ? '（本地服务无需）' : ''}</div>
              <input style={S.inp} type="password" value={p.apiKey || ''} placeholder={PRESETS[p.name]?.noKey ? '本地服务无需密钥' : 'sk-...'} onChange={e => updateProvider(p.id, { apiKey: e.target.value })} /></div>
            <div style={S.row}><div style={S.label}>接口地址（Base URL）</div><input style={S.inp} value={p.baseUrl || ''} onChange={e => updateProvider(p.id, { baseUrl: e.target.value })} /></div>
            <div style={S.row}><div style={S.label}>接口类型</div><select style={S.sel} value={p.type || 'OpenAI Compatible'} onChange={e => updateProvider(p.id, { type: e.target.value })}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
            <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>请求头（Headers）</div><textarea style={{ ...S.inp, height: 44, resize: 'vertical', padding: '8px 12px', fontFamily: 'monospace', fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="键=值" value={p.headers || ''} onChange={e => updateProvider(p.id, { headers: e.target.value })} /></div>
          </div>
          <div style={S.card}>
            <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text, marginBottom: 14 }}>模型列表</div>
            {p.models.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '12px 0' }}>暂无，点击"读取模型"从接口获取</div> : p.models.map((m: string, i: number) => {
              const caps = detectCaps([m])
              return <div key={i} style={U.betweenGap10Mb7}>
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
                <span style={U.flexGap3}>
                  {caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}
                </span>
                <button style={{ ...S.btn('ghost'), height: 28, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)', flexShrink: 0 }} onClick={() => updateProvider(p.id, { models: p.models.filter((_, j) => j !== i) })}>×</button>
              </div>
            })}
            <div style={U.endMt12}>
              {modelInput !== null ? <>
                <input style={{ ...S.inp, width: 200, height: 30, fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="模型编号…" value={modelInput} onChange={e => setModelInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && modelInput.trim()) { updateProvider(p.id, { models: [...p.models, modelInput.trim()] }); setModelInput(null) } }} autoFocus />
                <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (modelInput.trim()) { updateProvider(p.id, { models: [...p.models, modelInput.trim()] }); setModelInput(null) } }}>确认</button>
                <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setModelInput(null)}>取消</button>
              </> : <button style={S.btn('primary')} onClick={() => setModelInput('')}>添加模型</button>}
              <button style={S.btn('ghost')} disabled={loading} onClick={fetchModels}>{loading ? '读取中...' : '读取模型'}</button>
              <button style={S.btn('ghost')} disabled={testState.loading} onClick={() => testConnection('provider:' + p.id, p.baseUrl, p.apiKey, p.type === 'Anthropic Claude')}>{testState.loading && testState.key === 'provider:' + p.id ? '测试中...' : '测试连接'}</button>
              {testState.key === 'provider:' + p.id && testState.msg && (
                <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: testState.ok ? 'var(--success)' : 'var(--danger)', marginLeft: 4 }}>{testState.msg}</span>
              )}
            </div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 6 }}>若接口列表不全，可点「添加模型」手动输入模型 ID（如智谱视觉模型、方舟豆包模型）</div>
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
          <input style={{ ...S.inp, marginBottom: 10 }} placeholder="密钥（API Key）" value={newKey} onChange={e => setNewKey(e.target.value)} />
          <input style={{ ...S.inp, marginBottom: 10 }} placeholder="接口地址（Base URL）" value={newUrl} onChange={e => setNewUrl(e.target.value)} />
          <select style={{ ...S.sel, marginBottom: 14, width: '100%' }} value={newType} onChange={e => setNewType(e.target.value)}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
          <div style={U.flexEnd}><button style={S.btn('ghost')} onClick={() => setShowNew(false)}>取消</button><button style={S.btn('primary')} onClick={() => { if (!newName) return; addProvider({ id: 'custom_' + Date.now(), name: newName, type: newType, apiKey: newKey, baseUrl: newUrl, models: [], selectedModel: '' }); setShowNew(false) }}>保存</button></div>
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
            {(pr.models || []).filter((m: string) => detectCaps([m]).includes('多模态')).map((m: string) => <option key={m} value={m}>{m}</option>)}
              </optgroup>
            ))}
          </select>
          <div style={U.flexEnd}>
            <button style={S.btn('ghost')} onClick={() => setVisionPrompt(false)}>暂不配置</button>
            <button style={S.btn('primary')} onClick={() => { if (visionPick) { save({ visionModel: visionPick }); showToast('视觉辅助模型已设置：' + visionPick) } setVisionPrompt(false) }}>确认配置</button>
          </div>
        </div>
      </div> : null}
      {detectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setDetectModal(null)}>
          <div style={{ ...S.card, width: 480, maxHeight: '72vh', display: 'flex', flexDirection: 'column', padding: 24 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 4 }}>选择要添加的模型</div>
            <div style={U.centerGap8Mb12}>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, flex: 1 }}>已从接口读取 {detectModal.items.length} 个模型，勾选后点击「添加所选」才能使用</span>
              <button style={S.btn('ghost')} onClick={() => setDetectSel(detectModal.items.map(x => x.model))}>全选</button>
              <button style={S.btn('ghost')} onClick={() => setDetectSel([])}>清空</button>
            </div>
            <div style={U.scrollMb14}>
              {['多模态', '文字', '图片', '视频'].filter(g => detectModal.items.some(x => x.caps[0] === g)).map(g => (
                <div key={g}>
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', fontWeight: 700, color: CAP_COLORS[g] || C.text, margin: '8px 0 4px' }}>{g}</div>
                  {detectModal.items.filter(x => x.caps[0] === g).map(x => (
                    <label key={x.model} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
                      <input type="checkbox" checked={detectSel.includes(x.model)} onChange={e => { setDetectSel(prev => e.target.checked ? [...prev, x.model] : prev.filter(m => m !== x.model)) }} />
                      <span style={U.ellipsis1}>{x.model}</span>
                      <span style={U.flexGap3}>{x.caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div style={U.flexEnd}>
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
