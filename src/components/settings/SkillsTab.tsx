import { useState, useEffect } from 'react'
import { C, S } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 技能 tab(从 SettingsView 拆分, 行为零变化)
export default function SkillsTab() {
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const [skillsList, setSkillsList] = useState<{ name: string; path?: string; description?: string; builtin?: boolean }[]>([])
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [skillName, setSkillName] = useState(''); const [skillContent, setSkillContent] = useState(''); const [skillUrl, setSkillUrl] = useState('')
  const [suggs, setSuggs] = useState<{ signature: string; count: number; tools: string[]; example: string; recent: number }[]>([])
  const [val, setVal] = useState<{ ok: boolean; problems: { level: 'error' | 'warn'; msg: string }[] } | null>(null)
  const [stats, setStats] = useState<{ name: string; hit: number; trigger: number; ok: number; triggerRate: number; okRate: number }[]>([])
  useEffect(() => {
    window.huangquan.skills.list().then((s) => setSkillsList(s || [])).catch(() => setSkillsList([]))
    window.huangquan.settings.load().then((s) => setHidden(new Set((s.general?.hiddenSkills || []).map(String)))).catch(() => {})
    window.huangquan.skills.suggest(4).then((s) => setSuggs(s || [])).catch(() => setSuggs([]))
    window.huangquan.skills.stats(30).then((s) => setStats(s || [])).catch(() => setStats([]))
  }, [])
  // 实时校验(内容非空时)
  useEffect(() => {
    if (!skillContent.trim()) { setVal(null); return }
    const t = setTimeout(() => { window.huangquan.skills.validate(skillContent).then(setVal).catch(() => setVal(null)) }, 250)
    return () => clearTimeout(t)
  }, [skillContent])
  const toggleHidden = async (name: string, hide: boolean) => {
    try {
      const s = await window.huangquan.settings.load()
      const list = new Set((s.general?.hiddenSkills || []).map(String))
      if (hide) list.add(name); else list.delete(name)
      s.general = { ...s.general, hiddenSkills: [...list] }
      await window.huangquan.settings.save(s)
      setHidden(list)
      showToast(hide ? '已隐藏：不再注入系统提示（read_skill 仍可读取）' : '已恢复显示')
    } catch { showToast('设置保存失败') }
  }
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>已安装技能</div>
  <div style={S.hint}>技能是按统一规范打包的专项能力，会自动注入到系统提示词</div>
        {skillsList.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '10px 0' }}>暂无技能，可创建或从 GitHub 安装</div> : skillsList.map((sk, i: number) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: hidden.has(sk.name) ? C.muted : C.text, fontWeight: 600 }}>
                {sk.name}
                {sk.builtin ? <span style={{ marginLeft: 8, fontSize: 'calc(var(--ui-font-size) - 4px)', color: 'var(--accent)', border: '1px solid var(--accent)', borderRadius: 4, padding: '0 5px' }}>内置</span> : null}
                {hidden.has(sk.name) ? <span style={{ marginLeft: 8, fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}>（已隐藏）</span> : null}
              </div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: hidden.has(sk.name) ? 0.5 : 1 }}>{sk.description}</div>
            </div>
            <button style={{ ...S.btn('ghost'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={async () => { const c = await window.huangquan.skills.load(sk.path || ''); showToast(c.slice(0, 120) + (c.length > 120 ? '…' : '')) }}>查看</button>
            {sk.builtin
              ? <button style={{ ...S.btn('ghost'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={async () => {
                const c = await window.huangquan.skills.load(sk.path || '')
                if (!c) { showToast('读取失败'); return }
                const exists = skillsList.some(x => !x.builtin && x.name === sk.name)
                const target = exists ? sk.name + '-副本' : sk.name
                const r = await window.huangquan.skills.create(target, c)
                showToast(r === true ? '已复制为自定义技能「' + target + '」（可编辑）' : String(r))
                window.huangquan.skills.list().then((s) => setSkillsList(s || []))
              }}>复制</button>
              : null}
            {sk.builtin
              ? <button style={{ ...S.btn('ghost'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={() => toggleHidden(sk.name, !hidden.has(sk.name))}>{hidden.has(sk.name) ? '恢复' : '隐藏'}</button>
              : <button style={{ ...S.btn('danger'), height: 26, fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '0 10px', marginLeft: 8 }} onClick={async () => { if (!confirm('删除技能 ' + sk.name + '？')) return; const r = await window.huangquan.skills.delete(sk.name); showToast(r === true ? '已删除' : String(r)); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>删除</button>}
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={S.section}>从使用历史自动沉淀（程序记忆）</div>
        <div style={S.hint}>实验性：扫描最近审计，挑出反复出现 4 次以上的工具序列，建议固化为技能。生成的是步骤模板，请确认后再启用（防过拟合）。</div>
        {suggs.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '10px 0' }}>暂无足够重复的历史工作流。多用几次后这里会出现建议。</div> :
          suggs.map((sg, i) => (
            <div key={i} style={{ padding: '9px 12px', borderRadius: 6, background: C.input, marginBottom: 6, border: '1px solid ' + C.border }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text, fontWeight: 600 }}>
                {sg.tools.join(' → ')} <span style={{ color: 'var(--accent)', fontWeight: 400 }}>({sg.count} 次)</span>
              </div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginTop: 2, wordBreak: 'break-all' }}>例：{sg.example || '(无参数记录)'}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                <input style={{ ...S.inp, flex: 1 }} defaultValue={('workflow-' + sg.tools[sg.tools.length - 1] + '-' + (i + 1)).replace(/[^a-zA-Z0-9-_]/g, '-')} placeholder="技能名称" id={'sug-name-' + i} />
                <button style={S.btn('primary')} onClick={async () => {
                  const nameEl = document.getElementById('sug-name-' + i) as HTMLInputElement | null
                  const nm = (nameEl?.value || '').trim()
                  if (!nm) { showToast('请先填技能名称'); return }
                  const r = await window.huangquan.skills.createFromWorkflow(sg.signature, nm)
                  showToast(r === true ? '已生成技能 ' + nm + '（请查看并补充场景）' : String(r))
                  window.huangquan.skills.list().then((s) => setSkillsList(s || []))
                  window.huangquan.skills.suggest(4).then((s) => setSuggs(s || [])).catch(() => {})
                }}>生成技能</button>
              </div>
            </div>
          ))}
      </div>
      <div style={S.card}>
        <div style={S.section}>命中统计（近 30 天）</div>
        {stats.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', padding: '8px 0' }}>暂无命中记录 — 触发技能后这里会显示命中/触发率/成功率</div> :
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {stats.slice(0, 10).map(s => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.text }}>
                <span>{s.name} · {s.hit} 次</span>
                <span style={{ color: C.muted }}>触发率 {(s.triggerRate * 100).toFixed(0)}% · 成功率 {(s.okRate * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        }
      </div>
      <div style={S.card}>
        <div style={S.section}>创建技能</div>
  <input style={{ ...S.inp, marginBottom: 8 }} placeholder="技能名称（支持中文、拼音）" value={skillName} onChange={e => setSkillName(e.target.value)} />
        <textarea style={{ ...S.inp, height: 130, resize: 'vertical', padding: '10px', fontSize: 'calc(var(--ui-font-size) - 3px)', fontFamily: 'monospace', lineHeight: 1.5, marginBottom: 8 }} placeholder={'---\nname: 技能名\ndescription: 一句话描述\n---\n\n# 使用说明\n## 触发条件\n...'} value={skillContent} onChange={e => setSkillContent(e.target.value)} />
        {val && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: val.ok ? 'var(--accent)' : 'var(--danger)', marginBottom: 3 }}>{val.ok ? '✓ 校验通过，可保存' : '✕ 存在错误，无法保存'}</div>
            {val.problems.map((p, i) => (
              <div key={i} style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: p.level === 'error' ? 'var(--danger)' : 'var(--warning)', lineHeight: 1.45 }}>{p.level === 'error' ? '✕' : '⚠'} {p.msg}</div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button style={S.btn('primary')} onClick={async () => { if (!skillName.trim()) { showToast('请填写技能名称'); return } const r = await window.huangquan.skills.create(skillName.trim(), skillContent || '---\nname: ' + skillName + '\ndescription: ' + skillName + '\n---\n\n# ' + skillName); showToast(r === true ? '技能已创建' : String(r)); setSkillName(''); setSkillContent(''); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>创建技能</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>从 GitHub 安装</div>
        <div style={U.gap6}>
  <input style={{ ...S.inp, flex: 1 }} placeholder="仓库地址（例如 https://github.com/user/skill）" value={skillUrl} onChange={e => setSkillUrl(e.target.value)} />
          <button style={S.btn('primary')} onClick={async () => { if (!skillUrl.trim()) { showToast('请输入 Git 地址'); return } const r = await window.huangquan.skills.install(skillUrl.trim()); showToast(r === 'ok' ? '技能安装成功' : String(r)); setSkillUrl(''); window.huangquan.skills.list().then((s) => setSkillsList(s || [])) }}>安装</button>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
