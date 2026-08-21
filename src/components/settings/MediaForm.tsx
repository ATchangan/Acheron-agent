import React, { useState } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'
import { MEDIA_PRESETS, AI_TYPES, CAP_COLORS, detectCaps } from './consts'
import { U } from '../ui-styles'


// v0.3.1 块 H: 媒体平台配置表单(从 ModelsTab 拆出, 行为零变化)
const MediaForm: React.FC<{ mediaSelIdx: number; showToast: (msg: string) => void }> = ({ mediaSelIdx, showToast }) => {
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const mp = mediaProviders[mediaSelIdx]
  const updateMediaProvider = useSettingsStore(s => s.updateMediaProvider)
  const removeMediaProvider = useSettingsStore(s => s.removeMediaProvider)
  const [modelInput2, setModelInput2] = useState<string | null>(null)
  const [loading2, setLoading2] = useState(false)
  const [detectModal2, setDetectModal2] = useState<{ providerId: string; items: { model: string; caps: string[] }[] } | null>(null)
  const [detectSel2, setDetectSel2] = useState<string[]>([])
  // 有密钥但还没有任何模型时，自动读取一次（新填密钥或打开已有配置都会触发；失败可手动点「读取模型」重试）
  const autoFired2 = React.useRef<Set<string>>(new Set())
  React.useEffect(() => {
    const hasModels = !!mp && ((mp.imgModels || []).length > 0 || (mp.videoModels || []).length > 0 || (mp.audioModels || []).length > 0)
    if (!mp || !mp.baseUrl || !mp.apiKey || hasModels) return
    if (autoFired2.current.has(mp.id)) return
    autoFired2.current.add(mp.id)
    const t = setTimeout(async () => {
      try {
        const base = mp.baseUrl || ''
        const key = mp.apiKey || ''
        const r = await window.huangquan.models.detect(base, key, { type: mp.type, anthropic: mp.type === 'Anthropic Claude' })
        if (r.ok && r.models && r.models.length > 0) {
          const items = r.models.map((m: string) => ({ model: m, caps: detectCaps([m]) }))
          setDetectModal2({ providerId: mp.id, items })
          setDetectSel2([])
        }
      } catch { /* 静默失败，用户可手动重试 */ }
    }, 900)
    return () => clearTimeout(t)
  }, [mp?.id, mp?.apiKey, mp?.baseUrl])
  if (!mp) return null
  const detect2 = async () => {
    if (!mp.baseUrl) { showToast('请先填写接口地址'); return }
    setLoading2(true)
    try {
      const r = await window.huangquan.models.detect(mp.baseUrl, mp.apiKey || '', { type: mp.type, anthropic: mp.type === 'Anthropic Claude' })
      if (!r.ok) { showToast(r.error || '读取失败'); return }
      const items = (r.models || []).map((m: string) => ({ model: m, caps: detectCaps([m]) }))
      setDetectModal2({ providerId: mp.id, items })
      setDetectSel2([])
    } catch (e) { showToast('读取异常: ' + String(e)) } finally { setLoading2(false) }
  }
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={U.betweenMb18}>
          <span style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text }}>服务配置</span>
          <button style={S.btn('danger')} onClick={() => removeMediaProvider(mp.id)}>删除</button>
        </div>
        <div style={S.row}><div style={S.label}>平台名称</div><input style={S.inp} value={mp.name} onChange={() => { /* 名称不可编辑 */ }} /></div>
        <div style={S.row}><div style={S.label}>密钥（API Key）{MEDIA_PRESETS[mp.name]?.noKey ? '（本地服务无需）' : ''}</div>
          <input style={S.inp} type="password" value={mp.apiKey || ''} placeholder={MEDIA_PRESETS[mp.name]?.noKey ? '本地服务无需密钥' : 'sk-...'} onChange={e => updateMediaProvider(mp.id, { apiKey: e.target.value })} /></div>
        <div style={S.row}><div style={S.label}>接口地址（Base URL）</div><input style={S.inp} value={mp.baseUrl || ''} onChange={e => updateMediaProvider(mp.id, { baseUrl: e.target.value })} /></div>
        <div style={S.row}><div style={S.label}>接口类型</div><select style={S.sel} value={mp.type || 'OpenAI Compatible'} onChange={e => updateMediaProvider(mp.id, { type: e.target.value })}>{AI_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
        <div style={{ ...S.row, marginBottom: 0 }}><div style={S.label}>请求头（Headers）</div><textarea style={{ ...S.inp, height: 44, resize: 'vertical', padding: '8px 12px', fontFamily: 'monospace', fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="键=值" value={mp.headers || ''} onChange={e => updateMediaProvider(mp.id, { headers: e.target.value })} /></div>
      </div>
      <div style={S.card}>
        <div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 700, color: C.text, marginBottom: 14 }}>模型列表</div>
        {(() => {
          const allModels = [...(mp.imgModels || []), ...(mp.videoModels || []), ...(mp.audioModels || [])]
          if (!allModels.length) return <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '12px 0' }}>暂无，点击"读取模型"从接口获取</div>
          return allModels.map((m: string, i: number) => {
            const caps = detectCaps([m])
            const removeM = (mm: string) => {
              const img = (mp.imgModels || []).filter(x => x !== mm)
              const vid = (mp.videoModels || []).filter(x => x !== mm)
              const aud = (mp.audioModels || []).filter(x => x !== mm)
              updateMediaProvider(mp.id, { imgModels: img, videoModels: vid, audioModels: aud })
            }
            return <div key={i} style={U.betweenGap10Mb7}>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m}</span>
              <span style={U.flexGap3}>
                {caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}
              </span>
              <button style={{ ...S.btn('ghost'), height: 28, padding: '0 6px', fontSize: 'calc(var(--ui-font-size) - 3px)', flexShrink: 0 }} onClick={() => removeM(m)}>×</button>
            </div>
          })
        })()}
        <div style={U.endMt12}>
          {modelInput2 !== null ? <>
            <input style={{ ...S.inp, width: 200, height: 30, fontSize: 'calc(var(--ui-font-size) - 2px)' }} placeholder="模型编号…" value={modelInput2} onChange={e => setModelInput2(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && modelInput2.trim()) { const mm = modelInput2.trim(); const caps = detectCaps([mm]); const upd: Record<string, unknown> = {}; if (caps.includes('图片')) upd.imgModels = [...(mp.imgModels || []), mm]; if (caps.includes('视频')) upd.videoModels = [...(mp.videoModels || []), mm]; if (caps.includes('语音')) upd.audioModels = [...(mp.audioModels || []), mm]; if (!caps.includes('图片') && !caps.includes('视频') && !caps.includes('语音')) upd.imgModels = [...(mp.imgModels || []), mm]; updateMediaProvider(mp.id, upd); setModelInput2(null) } }} autoFocus />
            <button style={{ ...S.btn('primary'), height: 30 }} onClick={() => { if (modelInput2.trim()) { const mm = modelInput2.trim(); const caps = detectCaps([mm]); const upd: Record<string, unknown> = {}; if (caps.includes('图片')) upd.imgModels = [...(mp.imgModels || []), mm]; if (caps.includes('视频')) upd.videoModels = [...(mp.videoModels || []), mm]; if (caps.includes('语音')) upd.audioModels = [...(mp.audioModels || []), mm]; if (!caps.includes('图片') && !caps.includes('视频') && !caps.includes('语音')) upd.imgModels = [...(mp.imgModels || []), mm]; updateMediaProvider(mp.id, upd); setModelInput2(null) } }}>确认</button>
            <button style={{ ...S.btn('ghost'), height: 30 }} onClick={() => setModelInput2(null)}>取消</button>
          </> : <button style={S.btn('primary')} onClick={() => setModelInput2('')}>添加模型</button>}
          <button style={S.btn('ghost')} disabled={loading2} onClick={detect2}>{loading2 ? '读取中...' : '读取模型'}</button>
          <button style={S.btn('ghost')} onClick={async () => { const r = await window.huangquan.models.test(mp.baseUrl || '', mp.apiKey || '', { anthropic: mp.type === 'Anthropic Claude' }); showToast(r.message || (r.ok ? '连接成功' : '连接失败')) }}>测试连接</button>
        </div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 8 }}>调度绑定已移至「策略」页 — 所有模型公用</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 4 }}>若接口列表不全，可点「添加模型」手动输入模型 ID</div>
      </div>
      {detectModal2 && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--overlay-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={e => e.target === e.currentTarget && setDetectModal2(null)}>
          <div style={{ ...S.card, width: 480, maxHeight: '72vh', display: 'flex', flexDirection: 'column', padding: 24 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 700, color: C.text, marginBottom: 4 }}>选择要添加的模型</div>
            <div style={U.centerGap8Mb12}>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, flex: 1 }}>已从接口读取 {detectModal2.items.length} 个模型，勾选后点击「添加所选」才能使用</span>
              <button style={S.btn('ghost')} onClick={() => setDetectSel2(detectModal2.items.map(x => x.model))}>全选</button>
              <button style={S.btn('ghost')} onClick={() => setDetectSel2([])}>清空</button>
            </div>
            <div style={U.scrollMb14}>
              {['多模态', '文字', '图片', '视频', '语音'].filter(g => detectModal2.items.some(x => x.caps[0] === g)).map(g => (
                <div key={g}>
                  <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', fontWeight: 700, color: CAP_COLORS[g] || C.text, margin: '8px 0 4px' }}>{g}</div>
                  {detectModal2.items.filter(x => x.caps[0] === g).map(x => (
                    <label key={x.model} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>
                      <input type="checkbox" checked={detectSel2.includes(x.model)} onChange={e => { setDetectSel2(prev => e.target.checked ? [...prev, x.model] : prev.filter(m => m !== x.model)) }} />
                      <span style={U.ellipsis1}>{x.model}</span>
                      <span style={U.flexGap3}>{x.caps.map(c => <span key={c} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '1px 6px', borderRadius: 8, background: 'rgba(150,150,160,0.13)', color: CAP_COLORS[c] || C.text }}>{c}</span>)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            <div style={U.flexEnd}>
              <button style={S.btn('ghost')} onClick={() => setDetectModal2(null)}>取消</button>
              <button style={S.btn('primary')} disabled={!detectSel2.length} onClick={() => {
                const cur = mediaProviders.find(pp => pp.id === detectModal2.providerId)
                if (cur) {
                  const img = [...(cur.imgModels || [])]; const vid = [...(cur.videoModels || [])]; const aud = [...(cur.audioModels || [])]
                  for (const m of detectSel2) {
                    const caps = detectCaps([m])
                    if (caps.includes('图片')) img.push(m)
                    if (caps.includes('视频')) vid.push(m)
                    if (caps.includes('语音')) aud.push(m)
                    if (!caps.includes('图片') && !caps.includes('视频') && !caps.includes('语音')) img.push(m)
                  }
                  updateMediaProvider(cur.id, { imgModels: [...new Set(img)], videoModels: [...new Set(vid)], audioModels: [...new Set(aud)] })
                }
                setDetectModal2(null); setDetectSel2([])
              }}>添加所选 ({detectSel2.length})</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default MediaForm
