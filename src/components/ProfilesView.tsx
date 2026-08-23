// ProfilesView.tsx —— v0.4.2 配置档案（Profiles）：多套设置快照，一键切换/新建/重命名/删除
import { useEffect, useMemo, useState } from 'react'
import { Users, Plus, Pencil, Trash2, Check, User } from 'lucide-react'
import { useSettingsStore } from '../store/settings'
import type { SettingsData } from '../global'

const PROFILES_KEY = 'hq_profiles'
const ACTIVE_KEY = 'hq_active_profile'

function loadProfiles(): Record<string, SettingsData> {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '{}') } catch { return {} }
}

function saveProfiles(p: Record<string, SettingsData>) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(p))
}

export default function ProfilesView() {
  const [profiles, setProfiles] = useState<Record<string, SettingsData>>({})
  const [active, setActive] = useState<string>(() => localStorage.getItem(ACTIVE_KEY) || '')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [msg, setMsg] = useState('')

  const refresh = () => setProfiles(loadProfiles())
  useEffect(() => { refresh() }, [])

  const names = useMemo(() => Object.keys(profiles).sort(), [profiles])
  const toast = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2200) }

  const create = async () => {
    const name = newName.trim()
    if (!name || profiles[name]) return
    // 默认档案 = 当前设置快照
    const current = profiles[active] || await window.huangquan.settings.load().catch(() => ({} as SettingsData))
    const next = { ...profiles, [name]: current }
    saveProfiles(next)
    setProfiles(next)
    localStorage.setItem(ACTIVE_KEY, name)
    setActive(name)
    setCreating(false); setNewName('')
    toast('已创建档案「' + name + '」')
  }

  const activate = async (name: string) => {
    if (name === active) return
    const target = profiles[name]
    if (!target) return
    // 保存当前设置到当前档案，再切换到目标档案
    try {
      const current = await window.huangquan.settings.load()
      if (active && profiles[active]) {
        const next = { ...profiles, [active]: current }
        saveProfiles(next)
        setProfiles(next)
      }
      await window.huangquan.settings.save(target)
      localStorage.setItem(ACTIVE_KEY, name)
      setActive(name)
      await useSettingsStore.getState().load()
      toast('已切换到档案「' + name + '」')
    } catch { toast('切换失败') }
  }

  const rename = (oldName: string) => {
    const name = renameVal.trim()
    if (!name || name === oldName || profiles[name]) { setRenaming(null); return }
    const next: Record<string, SettingsData> = {}
    for (const [k, v] of Object.entries(profiles)) next[k === oldName ? name : k] = v
    saveProfiles(next)
    setProfiles(next)
    if (active === oldName) { localStorage.setItem(ACTIVE_KEY, name); setActive(name) }
    setRenaming(null)
    toast('已重命名')
  }

  const remove = (name: string) => {
    const next = { ...profiles }
    delete next[name]
    saveProfiles(next)
    setProfiles(next)
    if (active === name) { localStorage.removeItem(ACTIVE_KEY); setActive('') }
    setDeleting(null)
    toast('已删除档案')
  }

  return (
    <div className="hq-profiles">
      <div className="hq-profiles-head">
        <h2 className="hq-page-title"><Users size={16} /> 配置档案</h2>
        <span className="hq-page-subtitle">保存多套设置快照，随时切换工作环境</span>
      </div>

      {creating && (
        <div className="hq-profiles-create">
          <input autoFocus value={newName} placeholder="档案名称，如：开发 / 写作" onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setCreating(false) }} />
          <button type="button" className="hq-btn hq-btn-accent" onClick={() => void create()}>创建</button>
          <button type="button" className="hq-btn" onClick={() => setCreating(false)}>取消</button>
        </div>
      )}

      {names.length === 0 ? (
        <div className="hq-profiles-empty">
          <User size={34} className="hq-profiles-empty-icon" />
          <p className="hq-profiles-empty-title">还没有配置档案</p>
          <p className="hq-profiles-empty-desc">创建一个档案保存当前设置快照，之后可一键切换整套配置（模型、角色、外观、工具等）。</p>
          <button type="button" className="hq-btn hq-btn-accent" onClick={() => setCreating(true)}><Plus size={14} /> 新建档案</button>
        </div>
      ) : (
        <>
          <div className="hq-profiles-list">
            {names.map(name => (
              <div key={name} className={'hq-profiles-row' + (name === active ? ' active' : '')}>
                <button type="button" className="hq-profiles-row-main" onClick={() => void activate(name)}>
                  <span className="hq-profiles-avatar">{name.slice(0, 1).toUpperCase()}</span>
                  <span className="hq-profiles-name">{name}</span>
                  {name === active && <span className="hq-profiles-active"><Check size={12} /> 当前</span>}
                </button>
                <div className="hq-profiles-actions">
                  {renaming === name ? (
                    <input autoFocus defaultValue={name} onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') rename(name); if (e.key === 'Escape') setRenaming(null) }} />
                  ) : (
                    <button type="button" className="hq-icon-btn" title="重命名" aria-label="重命名" onClick={() => { setRenaming(name); setRenameVal(name) }}><Pencil size={13} /></button>
                  )}
                  {deleting === name ? (
                    <span className="hq-profiles-confirm">
                      <button type="button" className="hq-btn hq-btn-danger" onClick={() => remove(name)}>删除</button>
                      <button type="button" className="hq-btn" onClick={() => setDeleting(null)}>取消</button>
                    </span>
                  ) : (
                    <button type="button" className="hq-icon-btn danger" title="删除档案" aria-label="删除档案" onClick={() => setDeleting(name)}><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="hq-profiles-footer">
            <button type="button" className="hq-btn" onClick={() => setCreating(true)}><Plus size={14} /> 新建档案</button>
          </div>
        </>
      )}
      {msg && <div className="hq-toast hq-profiles-toast">{msg}</div>}
    </div>
  )
}
