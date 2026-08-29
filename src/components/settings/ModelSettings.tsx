// ModelSettings.tsx —— 设置「模型」页（对齐参考: 说明 + auto 下拉 + Set up provider + 默认值推理 + 辅助模型行）
import { useMemo } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S } from '../settings-ui'

export default function ModelSettings({ onGoTab }: { onGoTab: (tab: string) => void }) {
  const providers = useSettingsStore(s => s.providers || [])
  const general = useSettingsStore(s => s.general) || {}
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); useSettingsStore.getState().save() }

  const modelOpts = useMemo(() => providers.flatMap(pr => (pr.models || []).map(m => ({ id: pr.id + '::' + m, label: pr.name + ' · ' + m }))), [providers])
  const visionCands = useMemo(() => {
    const out: { id: string; label: string }[] = []
    providers.forEach(pr => (pr.models || []).forEach(m => { if (out.length < 30 && !out.some(x => x.id === pr.id + '::' + m)) out.push({ id: pr.id + '::' + m, label: pr.name + ' · ' + m }) }))
    return out
  }, [providers])

  // 辅助模型行（对齐参考: 名字+徽章 | 副标题「自动 · 使用主模型」| 右侧 设为主模型/更改）
  const auxRows: { name: string; badge: string; sub: string; value: string; onChange: (v: string) => void; placeholder: string }[] = [
    { name: '视觉', badge: '图片分析', sub: '自动 · 使用主模型', value: general.visionModel || '', onChange: v => save({ visionModel: v, visionModels: v ? [v] : [] }), placeholder: '自动 · 使用主模型' },
    { name: '长文本', badge: '文档分析', sub: '自动 · 使用主模型', value: general.longTextModel || '', onChange: v => save({ longTextModel: v }), placeholder: '自动 · 使用主模型' },
    { name: '代码', badge: '代码生成', sub: '自动 · 使用主模型', value: general.codeModel || '', onChange: v => save({ codeModel: v }), placeholder: '自动 · 使用主模型' },
    { name: '快速响应', badge: '轻量任务', sub: '自动 · 使用主模型', value: general.fastModel || '', onChange: v => save({ fastModel: v }), placeholder: '自动 · 使用主模型' },
  ]

  const resetAll = () => save({ longTextModel: '', codeModel: '', fastModel: '', visionModel: '', visionModels: [] })

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 12 }}>应用于新会话。可在输入框的模型选择器中临时切换当前对话。</div>

      {/* 默认模型（auto 全宽下拉） */}
      <select
        style={{ ...S.inp, height: 38, marginBottom: 16, cursor: 'pointer' }}
        value={general.mainModel || 'auto'}
        onChange={e => save({ mainModel: e.target.value === 'auto' ? '' : e.target.value })}
      >
        <option value="auto">auto</option>
        {modelOpts.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>

      <div style={{ marginBottom: 16 }}>
        <button type="button" style={{ ...S.btn('ghost'), height: 32 }} onClick={() => onGoTab('providers')}>Set up provider</button>
      </div>

      {/* 默认值 · 推理 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 700, color: C.text, width: 52, textAlign: 'center' }}>默认值</span>
        <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted, width: 30, textAlign: 'center' }}>推理</span>
        <select style={{ ...S.sel, height: 34 }} value={general.thinkLevel || '中'} onChange={e => save({ thinkLevel: e.target.value })}>
          {['关闭', '低', '中', '高'].map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>

      {/* 辅助模型 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 'calc(var(--ui-font-size) + 2px)', fontWeight: 650, color: C.text }}>辅助模型</span>
        <button type="button" className="aux-link" style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', textDecoration: 'underline' }} onClick={resetAll}>全部重置为主模型</button>
      </div>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 8 }}>辅助任务默认使用主模型。你可以为任意任务指定专用模型。</div>

      <div>
        {auxRows.map(r => (
          <div key={r.name} className="aux-row">
            <div className="aux-row-main">
              <div className="aux-row-name">{r.name}<span className="aux-row-badge">{r.badge}</span></div>
              <div className="aux-row-sub">{r.value ? modelOpts.find(x => x.id === r.value)?.label || r.value : r.sub}</div>
            </div>
            <div className="aux-row-actions">
              <button type="button" className="aux-link" title="恢复为主模型" onClick={() => r.onChange('')}>设为主模型</button>
              <select
                style={{ ...S.sel, height: 30, fontSize: 'calc(var(--ui-font-size) - 2px)', minWidth: 90, maxWidth: 260 }}
                value={r.value}
                onChange={e => r.onChange(e.target.value)}
                title="更改"
              >
                <option value="">{r.placeholder}</option>
                {visionCands.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
