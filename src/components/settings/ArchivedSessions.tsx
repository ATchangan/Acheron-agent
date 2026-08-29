// ArchivedSessions.tsx —— 设置「已归档对话」页：归档会话列表 + 恢复/删除
import { useEffect, useState } from 'react'
import { Archive, Trash2 } from 'lucide-react'
import { useChatStore } from '../../store/chat'
import { C } from '../settings-ui'

export default function ArchivedSessions() {
  const sessions = useChatStore(s => s.sessions)
  const del = useChatStore(s => s.del)
  const setArchivedLocal = (id: string, archived: boolean) => {
    void window.huangquan.sessions.setArchived(id, archived).then(ok => {
      if (ok) useChatStore.setState(st => ({ sessions: st.sessions.map(x => x.id === id ? { ...x, archived } : x) }))
    }).catch(() => {})
  }
  const [tick, setTick] = useState(0)
  useEffect(() => { const t = setInterval(() => setTick(x => x + 1), 5000); return () => clearInterval(t) }, [])
  void tick
  const archived = sessions.filter(s => s.archived)
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '18px 26px 30px' }}>
      <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.muted, marginBottom: 16 }}>
        归档的会话不显示在侧栏列表里，但数据仍在本地，可随时恢复或删除。
      </div>
      {archived.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '40px 0', color: 'var(--text-muted)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Archive size={20} /></div>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)' }}>没有已归档的对话</span>
        </div>
      ) : (
        <div>
          {archived.map(s => (
            <div key={s.id} className="aux-row">
              <div className="aux-row-main">
                <div className="aux-row-name">
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420 }} title={s.title}>{s.title || '（无标题）'}</span>
                  <span className="aux-row-badge">{(s.mode || 'work') === 'chat' ? '聊天' : '工作'}</span>
                </div>
                <div className="aux-row-sub">{s.updatedAt ? new Date(s.updatedAt).toLocaleString('zh-CN') : ''}</div>
              </div>
              <div className="aux-row-actions">
                <button type="button" className="aux-link" onClick={() => setArchivedLocal(s.id, false)}>恢复到侧栏</button>
                <button type="button" className="aux-link" title="删除会话" onClick={() => del(s.id)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
