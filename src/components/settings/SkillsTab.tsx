import React, { useState, useEffect } from 'react'
import { C, S } from '../settings-ui'

// v0.3.1 块 H: 技能 tab(从 SettingsView 拆分, 行为零变化)
export default function SkillsTab() {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const [skillsList, setSkillsList] = useState<{ name: string; path?: string; description?: string }[]>([])
  const [skillName, setSkillName] = useState(''); const [skillContent, setSkillContent] = useState(''); const [skillUrl, setSkillUrl] = useState('')
  useEffect(() => { window.huangquan.skills.list().then((s) => setSkillsList(s || [])).catch(() => setSkillsList([])) }, [])
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>已安装技能</div>
  <div style={S.hint}>技能是按统一规范打包的专项能力，会自动注入到系统提示词</div>
        {skillsList.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '10px 0' }}>暂无技能，可创建或从 GitHub 安装</div> : skillsList.map((sk, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, fontWeight: 600 }}>{sk.name}</div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sk.description}</div>
            </div>
            <button style={{ ...S.btn('ghost'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={async () => { const c = await window.huangquan.skills.load(sk.path || ''); showToast(c.slice(0, 120) + (c.length > 120 ? '…' : '')) }}>查看</button>
            <button style={{ ...S.btn('danger'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={async () => { if (!confirm('删除技能 ' + sk.name + '？')) return; const r = await window.huangquan.skills.delete(sk.name); showToast(r === true ? '已删除' : String(r)); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>删除</button>
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={S.section}>创建技能</div>
  <input style={{ ...S.inp, marginBottom: 8 }} placeholder="技能名称（支持中文、拼音）" value={skillName} onChange={e => setSkillName(e.target.value)} />
        <textarea style={{ ...S.inp, height: 130, resize: 'vertical', padding: '10px', fontSize: 'calc(var(--ui-font-size) - 3px)', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: 8 }} placeholder={'---\nname: 技能名\ndescription: 一句话描述\n---\n\n# 使用说明\n## 触发条件\n...'} value={skillContent} onChange={e => setSkillContent(e.target.value)} />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={S.btn('primary')} onClick={async () => { if (!skillName.trim()) { showToast('请填写技能名称'); return } const r = await window.huangquan.skills.create(skillName.trim(), skillContent || '---\nname: ' + skillName + '\ndescription: ' + skillName + '\n---\n\n# ' + skillName); showToast(r === true ? '技能已创建' : String(r)); setSkillName(''); setSkillContent(''); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>创建技能</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>从 GitHub 安装</div>
        <div style={{ display: 'flex', gap: 6 }}>
  <input style={{ ...S.inp, flex: 1 }} placeholder="仓库地址（例如 https://github.com/user/skill）" value={skillUrl} onChange={e => setSkillUrl(e.target.value)} />
          <button style={S.btn('primary')} onClick={async () => { if (!skillUrl.trim()) { showToast('请输入 Git 地址'); return } const r = await window.huangquan.skills.install(skillUrl.trim()); showToast(r === 'ok' ? '技能安装成功' : String(r)); setSkillUrl(''); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>安装</button>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
