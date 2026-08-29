import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { extractSkinColors, clearSkinInlineVars } from '../../store/settings'
import { C, S, Toggle, StepSetting, stepBtn } from '../settings-ui'
import { Minus, Plus } from 'lucide-react'
import { U } from '../ui-styles'


// v0.3.1 块 H: 外观 tab(从 SettingsView 拆分, 行为零变化)
// v0.4.2: 内置主题预设
const THEME_META = [
  { id: 'auto', label: '跟随系统', dots: ['#0e0e0e', '#9a9a9a', '#f8faff'] },
  { id: 'archeron', label: 'Archeron', dots: ['#1d1d28', '#c6cae0', '#c8cbda'] },
  { id: 'black', label: '极黑', dots: ['#0e0e0e', '#9a9a9a', '#eaeaea'] },
  { id: 'huangquan', label: '黄泉', dots: ['#121014', '#a78bfa', '#ede9f4'] },
  { id: 'ocean', label: '深蓝', dots: ['#0d2f86', '#ffe6cb', '#0053fd'] },
  { id: 'midnight', label: '午夜', dots: ['#08081c', '#ddd6ff', '#8b80e8'] },
  { id: 'ember', label: '余烬', dots: ['#160800', '#ffd8b0', '#d97316'] },
  { id: 'mono', label: '单色', dots: ['#0e0e0e', '#eaeaea', '#9a9a9a'] },
  { id: 'cyberpunk', label: '赛博朋克', dots: ['#000a00', '#00ff41', '#00ff41'] },
  { id: 'slate', label: '石板', dots: ['#0d1117', '#c9d1d9', '#58a6ff'] },
  { id: 'light', label: '浅色', dots: ['#f8faff', '#0053fd', '#17171a'] },
]
const toHex = (v: string): string => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : '#17181c'
const currentTheme = (g: { theme?: string; themePreset?: string }): string => g.themePreset || g.theme || 'auto'

export default function SkinTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [bgOp, setBgOp] = useState(g.bgOpacity ?? 0.7)
  const hasBg = !!g.bgImage
  useEffect(() => { setBgOp(g.bgOpacity ?? 0.7) }, [g?.bgOpacity])
  const [, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  return (
    <div style={U.pageBody}>
      <div style={S.card}><div style={S.section}>主题（配色体系）</div>
        <div style={S.hint}>官方主题预设 + 自定义配色；主题只管配色，和背景皮肤互不影响</div>
        <div style={U.grid3}>
          {THEME_META.map(t => {
            const active = currentTheme(g) === t.id
            return <div key={t.id} onClick={() => { save({ theme: t.id, themePreset: undefined }); useSettingsStore.getState().setTheme(t.id) }} style={{ padding: 10, borderRadius: 8, border: '1px solid ' + (active ? C.accent : C.border), cursor: 'pointer', background: active ? C.accentBg : 'transparent', textAlign: 'center' }}>
              <div style={U.centerGap5Mb6}>
                {t.dots.map(d => <span key={d} style={{ width: 13, height: 13, borderRadius: '50%', background: d, border: '1px solid rgba(150,150,160,.35)' }} />)}
              </div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: active ? C.accent : C.text }}>{t.label}</div>
            </div>
          })}
          {(() => {
            const active = currentTheme(g) === 'custom'
            const cc = g.customColors || g.customTheme || {}
            const cdots = [cc.bg || '#17181c', cc.accent || '#7c6fa8', cc.text || '#e2e2e8']
            return <div onClick={() => { save({ theme: 'custom', themePreset: undefined }); useSettingsStore.getState().setTheme('custom') }} style={{ padding: 10, borderRadius: 8, border: '1px solid ' + (active ? C.accent : C.border), cursor: 'pointer', background: active ? C.accentBg : 'transparent', textAlign: 'center' }}>
              <div style={U.centerGap5Mb6}>
                {cdots.map(d => <span key={d} style={{ width: 13, height: 13, borderRadius: '50%', background: d, border: '1px solid rgba(150,150,160,.35)' }} />)}
              </div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: active ? C.accent : C.text }}>自定义</div>
            </div>
          })()}
        </div>
        {currentTheme(g) === 'custom' && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed ' + C.border }}>
          <div style={S.hint}>实时预览（不落盘），点「应用」保存；「恢复默认」清除自定义回到暗夜</div>
          {([['背景', 'bg'], ['卡片', 'surface'], ['强调', 'accent'], ['文字', 'text']] as const).map(([cn, ck]) => {
            const cc = (g.customColors || g.customTheme || {})[ck]
            return <div key={ck} style={U.centerGap8mt6}>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.label, width: 40, flexShrink: 0 }}>{cn}</span>
              <input type="color" value={toHex(cc || '')} onChange={e => {
                const next = { ...(g.customColors || g.customTheme || {}), [ck]: e.target.value }
                const r = document.documentElement.style
                if (ck === 'bg') r.setProperty('--bg-root', e.target.value)
                else if (ck === 'surface') r.setProperty('--bg-surface', e.target.value)
                else if (ck === 'accent') r.setProperty('--accent', e.target.value)
                else if (ck === 'text') r.setProperty('--text-primary', e.target.value)
                save({ customColors: next })
              }} style={{ width: 36, height: 26, border: 'none', background: 'none', cursor: 'pointer', padding: 0 }} />
  <input style={{ ...S.inp, flex: 1 }} value={cc || ''} placeholder="颜色代码（例如 #RRGGBB）" onChange={e => save({ customColors: { ...(g.customColors || g.customTheme || {}), [ck]: e.target.value } })} />
            </div>
          })}
          <div style={U.gap8mt10}>
            <button style={S.btn('primary')} onClick={() => { save({ theme: 'custom', themePreset: undefined }); useSettingsStore.getState().setTheme('custom') }}>应用</button>
            <button style={S.btn('ghost')} onClick={() => { save({ theme: 'dark', themePreset: undefined, customColors: undefined }); useSettingsStore.getState().setTheme('dark'); clearSkinInlineVars() }}>恢复默认</button>
          </div>
        </div>}
      </div>
      <div style={{ borderTop: '1px dashed ' + C.border, margin: '18px 0' }} />
      <div style={S.card}><div style={S.section}>皮肤（背景叠加）</div>
        <div style={U.gap8mt6}>
          <input type="file" accept="image/*" style={U.none} id="bgImg" onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { useSettingsStore.getState().setBgImage(r.result as string) }; r.readAsDataURL(f) }} />
          <button style={S.btn('primary')} onClick={() => document.getElementById('bgImg')?.click()}>选择图片</button>
          {hasBg && <button style={S.btn('danger')} onClick={() => { useSettingsStore.getState().setBgImage(null) }}>清除</button>}
        </div>
        {hasBg && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <span style={U.fs2label}>透明度</span>
          <div style={U.centerGap8}>
            <button style={stepBtn} title="减小" onClick={() => { const v = Math.max(0.05, Math.round((bgOp - 0.05) * 100) / 100); setBgOp(v); useSettingsStore.getState().setBgOpacity(v) }}><Minus size={14} /></button>
            <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.text, minWidth: 44, textAlign: 'center' }}>{Math.round(bgOp * 100)}%</span>
            <button style={stepBtn} title="增大" onClick={() => { const v = Math.min(1, Math.round((bgOp + 0.05) * 100) / 100); setBgOp(v); useSettingsStore.getState().setBgOpacity(v) }}><Plus size={14} /></button>
          </div>
        </div>}
        {hasBg && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={U.fs2label}>遮罩</span>
          {[['light', '亮', 'rgba(0,0,0,.15)'], ['medium', '中', 'rgba(0,0,0,.35)'], ['dark', '暗', 'rgba(0,0,0,.55)']].map(([k, label, v]) => {
            const on = (g.skinMask || 'medium') === k
            return <button key={k} onClick={() => { save({ skinMask: k }); document.documentElement.style.setProperty('--bg-mask', v) }} style={{ ...stepBtn, display: 'inline-flex', alignItems: 'center', gap: 5, border: '1px solid ' + (on ? C.accent : C.border), color: on ? C.accent : C.text }}>
              <span style={{ width: 12, height: 12, borderRadius: '50%', background: v, border: '1px solid ' + C.border, display: 'inline-block' }} />{label}
            </button>
          })}
        </div>}
        {hasBg && <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <span style={U.fs2label}>辅色</span>
          <span style={{ width: 18, height: 18, borderRadius: 4, background: g.skinSecondary ? 'rgb(' + g.skinSecondary + ')' : 'transparent', border: '1px solid ' + C.border }} />
          <button style={S.btn('ghost')} onClick={async () => {
            if (!g.bgImage) return
            const c = await extractSkinColors(g.bgImage)
            save({ skinSecondary: `${c.secondary.r},${c.secondary.g},${c.secondary.b}` })
            document.documentElement.style.setProperty('--skin-secondary', `${c.secondary.r},${c.secondary.g},${c.secondary.b}`)
            showToast('辅色已重新提取')
          }}>重新提取</button>
        </div>}
      </div>
      <div style={S.card}><div style={S.section}>排版</div>
        <div style={S.row}><div style={S.label}>界面字号</div><select style={S.sel} value={g.uiFontSize || 13} onChange={e => save({ uiFontSize: parseInt(e.target.value) })}>{[12, 13, 14, 15, 16, 18].map(s => <option key={s} value={s}>{s}px</option>)}</select></div>
        <div style={S.row}><div style={S.label}>会话字号</div><select style={S.sel} value={g.codeFontSize || 0} onChange={e => { const v = e.target.value; save({ codeFontSize: v ? parseInt(v) : undefined }) }}><option value={0}>跟随界面</option>{[12, 13, 14, 15, 16, 18].map(s => <option key={s} value={s}>{s}px</option>)}</select></div>
        <div style={S.row}><div style={S.label}>会话模式</div><select style={S.sel} value={g.mode || 'work'} onChange={e => save({ mode: e.target.value })}><option value="chat">聊天</option><option value="work">工作</option></select></div>
        <div style={S.hint}>聊天模式使用助手人设闲聊，工作模式使用高效执行人设；也可在左侧会话区顶部快速切换</div>
        <div style={S.hint}>控制交互会话（聊天正文、输入框、消息内代码与工具输出）的字号，默认跟随界面字号</div>
      </div>
      <div style={S.card}><div style={S.section}>布局</div>
        <StepSetting label="会话区宽度" hint="消息区与输入框宽度（默认 780px）" value={g.chatMaxWidth || 780} min={480} max={1400} step={20} unit=" px" onChange={v => save({ chatMaxWidth: v })} />
        <Toggle checked={g.showTimestamps !== 'hover'} onChange={v => save({ showTimestamps: v ? 'always' : 'hover' })} label="始终显示时间戳" hint="关闭后仅悬停显示" />
      </div>
    </div>
  )
}
