import React, { useState, useEffect, useCallback } from 'react'

export default function MemoryView() {
  const [pinnedFacts, setPinnedFacts] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState('')
  const [newPinned, setNewPinned] = useState('')

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000) }

  const load = useCallback(async () => {
    try { setLoading(true); const m = await window.huangquan.memory.load(); setPinnedFacts(m.pinnedFacts || []) }
    catch { setPinnedFacts([]) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // v0.2.3-fix(N23): 记忆读写失败不再产生未处理 rejection
  const addPinned = async () => {
    if (!newPinned.trim()) return
    try {
      const m = await window.huangquan.memory.load()
      ;m.pinnedFacts = [...(m.pinnedFacts || []), newPinned.trim()]
      await window.huangquan.memory.save(m)
      setPinnedFacts([...m.pinnedFacts]); setNewPinned(''); showToast('已添加')
    } catch { showToast('保存失败') }
  }

  const deletePinned = async (index: number) => {
    try {
      const m = await window.huangquan.memory.load()
      ;const pf = m.pinnedFacts || []; pf.splice(index, 1); m.pinnedFacts = pf
      await window.huangquan.memory.save(m)
      setPinnedFacts([...(m.pinnedFacts || [])]); showToast('已删除')
    } catch { showToast('删除失败') }
  }

  const s = {
    container: { padding: '24px 28px', height: '100%', overflowY: 'auto' as const, color: 'var(--text-primary)', background: 'rgba(13,13,26,0.55)' },
    title: { fontSize: 20, fontWeight: 600, color: 'var(--accent)', marginBottom: 4 },
    subtitle: { fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', marginBottom: 20 },
    section: { marginBottom: 24 },
    sectionTitle: { fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: 'var(--warning)', marginBottom: 8 },
    card: { background: 'rgba(30,30,56,0.6)', border: '1px solid var(--warning-soft)', borderRadius: 8, padding: '10px 14px', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    factText: { fontSize: 'var(--ui-font-size)', color: 'var(--text-primary)', flex: 1, whiteSpace: 'pre-wrap' as const },
    btn: (color: string) => ({ background: 'transparent', border: `1px solid ${color}`, color, padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)', marginLeft: 8 } as React.CSSProperties),
    inp: { background: 'rgba(20,20,40,0.8)', border: '1px solid #3a3c46', color: 'var(--text-primary)', padding: '6px 10px', borderRadius: 4, fontSize: 'calc(var(--ui-font-size) - 1px)', flex: 1, outline: 'none' } as React.CSSProperties,
    empty: { textAlign: 'center' as const, color: 'var(--text-muted)', fontSize: 'calc(var(--ui-font-size) - 1px)', padding: 20 },
    toast: { position: 'fixed' as const, bottom: 24, right: 24, background: '#262830', border: '1px solid #7c6fa8', color: 'var(--text-primary)', padding: '8px 16px', borderRadius: 6, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 1000 },
  }

  const totalChars = pinnedFacts.reduce((s, f) => s + f.length, 0)

  return (
    <div style={s.container}>
      <h1 style={s.title}>◈ 置顶记忆</h1>
      <p style={s.subtitle}>{loading ? '加载中...' : `${pinnedFacts.length} 条 · ${totalChars} 字符`}</p>
      <p style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', marginBottom: 16 }}>唯一持久存储载体 — 系统规则、Agent配置、个人偏好均存于此</p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <input style={s.inp} value={newPinned} onChange={e => setNewPinned(e.target.value)} onKeyDown={e => e.key === 'Enter' && addPinned()} placeholder="添加置顶记忆..." />
        <button style={{...s.btn('var(--warning)'), marginLeft: 0}} onClick={addPinned}>添加</button>
      </div>

      {pinnedFacts.length === 0 ? <div style={s.empty}>暂无置顶记忆 — 在对话中说"记住xxx"即可写入</div> :
        pinnedFacts.map((f, i) => (
          <div key={i} style={s.card}>
            <span style={s.factText}>{f.length > 200 ? f.slice(0, 200) + '...' : f}</span>
            <button style={s.btn('var(--danger)')} onClick={() => deletePinned(i)}>删除</button>
          </div>
        ))
      }

      {toast && <div style={s.toast}>{toast}</div>}
    </div>
  )
}