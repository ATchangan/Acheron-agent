// ProfileStrip.tsx —— v0.4.4 侧栏底部配置档案条（对齐参考: [default ˅] [+] [导入] … [管理]）
// 配置档案 = 设置快照：新建档案保存当前全部设置；切换档案时写回并重载应用。
import { useEffect, useState } from 'react'
import { ChevronDown, Plus, Upload, Settings2, Check, Trash2 } from 'lucide-react'

const PROFILES_KEY = 'hq_profiles'
const CURRENT_KEY = 'hq_profiles_current'
type ProfileMap = Record<string, Record<string, unknown>>

const readProfiles = (): ProfileMap => { try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}') } catch { return {} } }
const writeProfiles = (m: ProfileMap): void => { try { localStorage.setItem(PROFILES_KEY, JSON.stringify(m)) } catch { /* 忽略 */ } }
const currentName = (): string => localStorage.getItem(CURRENT_KEY) || 'default'

export default function ProfileStrip() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [cur, setCur] = useState(currentName())

  const [hidden, setHidden] = useState(() => localStorage.getItem('hq_profilestrip_hidden') === '1')
  useEffect(() => {
    const f = () => setHidden(localStorage.getItem('hq_profilestrip_hidden') === '1')
    window.addEventListener('hq-layout-changed', f)
    return () => window.removeEventListener('hq-layout-changed', f)
  }, [])
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t && typeof t.closest === 'function' && t.closest('.hq-profile-strip')) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const names = () => Object.keys(readProfiles())
  const snapshot = async (name: string): Promise<boolean> => {
    try {
      const cfg = await window.huangquan.settings.load()
      const m = readProfiles()
      m[name] = cfg as unknown as Record<string, unknown>
      writeProfiles(m)
      return true
    } catch { return false }
  }
  const switchTo = async (name: string) => {
    const blob = readProfiles()[name]
    if (!blob) return
    if (!confirm(`切换到配置档案「${name}」？当前未保存的设置将被档案内容覆盖，应用会重载。`)) return
    // 先把当前设置存回原档案，再应用目标档案
    await snapshot(cur)
    try { await window.huangquan.settings.save(blob as never) } catch { /* 忽略 */ }
    localStorage.setItem(CURRENT_KEY, name)
    window.location.reload()
  }
  const createProfile = async () => {
    const n = newName.trim()
    if (!n) return
    if (await snapshot(n)) { setCur(n); localStorage.setItem(CURRENT_KEY, n) }
    setCreating(false); setNewName(''); setMenuOpen(false)
  }
  const importProfile = () => {
    const f = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' })
    f.onchange = async () => {
      try {
        const t = await f.files?.[0]?.text()
        if (!t) return
        const cfg = JSON.parse(t) as Record<string, unknown>
        const n = '导入-' + new Date().toISOString().slice(5, 16).replace('T', ' ')
        const m = readProfiles(); m[n] = cfg; writeProfiles(m)
        if (!confirm(`已导入为档案「${n}」，立即应用？`)) return
            try { await window.huangquan.settings.save(cfg) } catch { /* 忽略 */ }
        localStorage.setItem(CURRENT_KEY, n)
        window.location.reload()
      } catch { alert('导入失败，文件格式不正确') }
    }
    f.click()
  }
  const removeProfile = (n: string) => {
    if (n === cur) { alert('不能删除正在使用的配置档案'); return }
    if (!confirm(`删除配置档案「${n}」？`)) return
    const m = readProfiles(); delete m[n]; writeProfiles(m)
    setTick(t => t + 1)
  }
  const [tick, setTick] = useState(0)
  void tick

  if (hidden) return null
  return (
    <div className="hq-profile-strip">
      {creating ? (
        <div className="hq-profile-form">
          <input autoFocus value={newName} placeholder="档案名（如：写作模式）" onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void createProfile(); if (e.key === 'Escape') setCreating(false) }} />
          <button type="button" className="hq-mini-btn" title="保存当前设置为该档案" onClick={() => { void createProfile() }}><Check size={12} /></button>
          <button type="button" className="hq-mini-btn" title="取消" onClick={() => setCreating(false)}><Trash2 size={12} /></button>
        </div>
      ) : (
        <>
          <button type="button" className={'hq-profile-pill' + (menuOpen ? ' open' : '')} title="配置档案" onClick={() => setMenuOpen(v => !v)}>
            <span className="hq-profile-name">{cur}</span>
            <ChevronDown size={11} />
          </button>
          <button type="button" className="hq-sb-mini" title="把当前设置保存为新配置档案" onClick={() => { setNewName(''); setCreating(true) }}><Plus size={13} /></button>
          <button type="button" className="hq-sb-mini" title="导入配置档案（.json）" onClick={importProfile}><Upload size={12} /></button>
          <span style={{ flex: 1 }} />
          <button type="button" className="hq-sb-mini" title="管理配置档案" onClick={() => setMenuOpen(v => !v)}><Settings2 size={12} /></button>

          {menuOpen && (
            <div className="hq-profile-menu">
              <div className="hq-profile-menu-title">配置档案</div>
              {names().length === 0 && <div className="hq-profile-menu-empty">还没有保存过档案。点 + 把当前设置存为档案，之后一键切换。</div>}
              {names().map(n => (
                <div key={n} className={'hq-profile-menu-item' + (n === cur ? ' current' : '')}>
                  <button type="button" className="hq-profile-menu-name" title={n === cur ? '当前档案' : '切换到该档案'} onClick={() => { if (n !== cur) void switchTo(n); else setMenuOpen(false) }}>
                    {n === cur && <Check size={12} />}{n}
                  </button>
                  <button type="button" className="hq-mini-btn" title="删除档案" onClick={() => removeProfile(n)}><Trash2 size={11} /></button>
                </div>
              ))}
              <div className="hq-profile-menu-sep" />
              <button type="button" className="hq-profile-menu-item" onClick={() => { void snapshot(cur); setMenuOpen(false) }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}><Check size={12} />把当前设置保存到「{cur}」</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
