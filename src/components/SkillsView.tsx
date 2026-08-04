import React, { useState, useEffect, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import type { SkillMeta } from '../global'
import { errMsg } from '../utils/safe'

/* ─── 黄泉法术录 · 类型 & 常量 ──────────────────────────── */

type Category = '工作流' | '提示词' | '知识' | '工具' | '自动化'

interface SkillWithCategory extends SkillMeta {
  category: Category
}

const CATEGORIES: Category[] = ['工作流', '提示词', '知识', '工具', '自动化']
const CAT_ICON: Record<Category, string> = {
  '工作流': '🔄',
  '提示词': '💬',
  '知识': '📚',
  '工具': '🔧',
  '自动化': '⚡',
}
const CAT_COLOR: Record<Category, string> = {
  '工作流': 'var(--accent)',
  '提示词': 'var(--accent-purple)',
  '知识': 'var(--success)',
  '工具': 'var(--warning)',
  '自动化': 'var(--danger)',
}

/* ─── 辅助函数 ────────────────────────────────────────── */

function inferCategory(skill: SkillMeta): Category {
  const haystack = (skill.path + ' ' + skill.name + ' ' + (skill.description || '')).toLowerCase()
  if (/(?:workflow|工作流|flow|pipeline)/i.test(haystack)) return '工作流'
  if (/(?:prompt|提示词|提示|instruction)/i.test(haystack)) return '提示词'
  if (/(?:knowledge|知识|doc|wiki|rag)/i.test(haystack)) return '知识'
  if (/(?:tool|工具|util|helper)/i.test(haystack)) return '工具'
  if (/(?:auto|自动化|agent|cron|schedule)/i.test(haystack)) return '自动化'
  return '工作流'
}

function buildSkillPath(name: string, category: Category): string {
  const slug = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '')
  const dir = CATEGORIES.indexOf(category) >= 0 ? category : '工作流'
  return `skills/${dir}/${slug}.md`
}

// 所有捕获组先 escapeHtml 再包标签 —— 修复 XSS(此前 heading/inline-code/link/img 原样注入)
function renderMarkdown(src: string): string {
  let html = src
  const esc = escapeHtml
  /* fenced code blocks */
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    (_: string, lang: string, body: string) =>
      `<pre><code class="language-${esc(lang)}">${esc(body.trimEnd())}</code></pre>`)
  /* inline code */
  html = html.replace(/`([^`\n]+)`/g, (_m, c: string) => '<code>' + esc(c) + '</code>')
  /* headings */
  html = html.replace(/^#### (.+)$/gm, (_m, c: string) => '<h4>' + esc(c) + '</h4>')
  html = html.replace(/^### (.+)$/gm, (_m, c: string) => '<h3>' + esc(c) + '</h3>')
  html = html.replace(/^## (.+)$/gm, (_m, c: string) => '<h2>' + esc(c) + '</h2>')
  html = html.replace(/^# (.+)$/gm, (_m, c: string) => '<h1>' + esc(c) + '</h1>')
  /* bold + italic */
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, (_m, c: string) => '<strong><em>' + esc(c) + '</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, (_m, c: string) => '<strong>' + esc(c) + '</strong>')
  html = html.replace(/\*(.+?)\*/g, (_m, c: string) => '<em>' + esc(c) + '</em>')
  /* images —— 仅允许 http(s)/data: 协议, 其余丢弃 */
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src2: string) => {
    const s = src2.trim()
    return /^(https?:|data:image\/)/i.test(s) ? '<img alt="' + esc(alt) + '" src="' + esc(s) + '" />' : ''
  })
  /* links —— javascript:/data: 协议丢弃 */
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, txt: string, href: string) => {
    const h = href.trim()
    return /^(https?:|mailto:|#)/i.test(h) ? '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + esc(txt) + '</a>' : esc(txt)
  })
  /* unordered lists */
  html = html.replace(/^[*-] (.+)$/gm, (_m, c: string) => '<li>' + esc(c) + '</li>')
  /* blockquote */
  html = html.replace(/^&gt; (.+)$/gm, (_m, c: string) => '<blockquote>' + esc(c) + '</blockquote>')
  /* horizontal rule */
  html = html.replace(/^---$/gm, '<hr />')
  /* paragraphs: double newline → <br/><br/> */
  html = html.replace(/\n\n/g, '<br/><br/>')
  return html
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/* ─── 组件 ───────────────────────────────────────────── */

export default function SkillsView() {
  /* ---------- state ---------- */
  const [skills, setSkills] = useState<SkillWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* create form */
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newCategory, setNewCategory] = useState<Category>('工作流')
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)

  /* viewer */
  const [viewingSkill, setViewingSkill] = useState<SkillWithCategory | null>(null)
  const [viewContent, setViewContent] = useState('')
  const [viewLoading, setViewLoading] = useState(false)

  /* toast */
  const [toast, setToast] = useState('')

  /* ---------- helpers ---------- */
  const loadSkills = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const list: SkillMeta[] = await window.huangquan.skills.list()
      setSkills(list.map((s) => ({ ...s, category: inferCategory(s) })))
    } catch (e: unknown) {
      setError(errMsg(e) || '无法加载技能列表')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadSkills() }, [loadSkills])

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  /* ---------- actions ---------- */
  const handleView = async (skill: SkillWithCategory) => {
    try {
      setViewLoading(true)
      setViewingSkill(skill)
      setViewContent('')
      const content = await window.huangquan.skills.load(skill.path)
      setViewContent(content)
    } catch (e: unknown) {
      setViewContent(`> 加载失败: ${errMsg(e) || '未知错误'}`)
    } finally {
      setViewLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!newName.trim() || !newContent.trim()) return
    try {
      setSaving(true)
      const path = buildSkillPath(newName, newCategory)
      const header = [
        `# ${newName.trim()}`,
        '',
        `> **类别**: ${newCategory}  |  ${newDesc.trim() || '暂无描述'}`,
        '',
        '---',
        '',
      ].join('\n')
      await window.huangquan.computer.writeFile(path, header + newContent.trim())
      setShowCreate(false)
      resetCreateForm()
      await loadSkills()
      showToast(`✅ 法术「${newName.trim()}」已铭刻`)
    } catch (e: unknown) {
      setError(`保存失败: ${errMsg(e) || '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const resetCreateForm = () => {
    setNewName(''); setNewDesc(''); setNewCategory('工作流'); setNewContent('')
  }

  const handleXing = () => {
    try {
      useChatStore.getState().send('/xing 请从对话中提取可复用的技能，并以SKILL.md格式保存到skills/目录。')
      showToast('✨ 已发送提取指令到对话，请切换到聊天视图查看结果')
    } catch {
      showToast('⚠️ 无法发送指令，请手动在聊天中输入 /xing')
    }
  }

  /* ---------- stats ---------- */
  const stats = CATEGORIES.map((cat) => ({
    category: cat,
    count: skills.filter((s) => s.category === cat).length,
  }))
  const totalSkills = skills.length

  /* ---------- render ---------- */
  return (
    <div className="skills-root" style={S.container}>
      {/* ── Header ── */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>✦ 技能</h1>
          <p style={S.subtitle}>可复用的技能与工作流 · {totalSkills} 个法术</p>
        </div>
        <div style={S.headerActions}>
          <button className="btn-small" onClick={handleXing} title="从对话中提取可复用的技能">
            ✨ 从对话提取技能
          </button>
          <button className="btn-primary" onClick={() => setShowCreate(true)}>
            + 新建技能
          </button>
        </div>
      </div>

      {/* ── Stats bar ── */}
      <div style={S.statsBar}>
        {stats.map((s) => (
          <div key={s.category} style={S.statItem}>
            <span>{CAT_ICON[s.category]}</span>
            <span style={S.statLabel}>{s.category}</span>
            <span style={{ ...S.statCount, color: CAT_COLOR[s.category] }}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={S.errorBar}>
          <span>{error}</span>
          <button className="btn-icon" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {/* ── Skills grid ── */}
      {loading ? (
        <div className="empty-hint" style={{ textAlign: 'center' }}>🕯️ 加载法术中...</div>
      ) : skills.length === 0 ? (
        <div style={S.empty}>
          <span style={S.emptyIcon}>📜</span>
          <p style={{ margin: '8px 0 4px', color: 'var(--text-secondary)' }}>尚未收录任何法术</p>
          <p className="empty-hint" style={{ margin: 0 }}>
            点击「新建技能」创建第一个技能，或从对话中提取
          </p>
        </div>
      ) : (
        <div style={S.grid}>
          {skills.map((skill) => (
            <div key={skill.path} style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.cardIcon}>{CAT_ICON[skill.category]}</span>
                <span style={{ ...S.badge, color: CAT_COLOR[skill.category], borderColor: CAT_COLOR[skill.category] }}>
                  {skill.category}
                </span>
              </div>
              <h3 style={S.cardTitle}>{skill.name}</h3>
              <p style={S.cardDesc}>{skill.description || '暂无描述'}</p>
              <div style={S.cardPath} title={skill.path}>{skill.path}</div>
               <div style={S.cardActions}>
                 <button className="btn-small" onClick={() => handleView(skill)}>📖 查看</button>
                 <button className="btn-small" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                   onClick={async () => {
                     if (!confirm(`确定删除技能「${skill.name}」？`)) return
                     try {
                       const ok = await window.huangquan.skills.delete(skill.name)
                       if (ok === true) { showToast(`已删除「${skill.name}」`); loadSkills() }
                       else showToast('删除失败: ' + ok)
                     } catch (e: unknown) { showToast('删除失败: ' + errMsg(e)) }
                   }}>🗑 删除</button>
               </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Create Skill Modal ── */}
      {showCreate && (
        <div style={S.overlay} onClick={() => { setShowCreate(false); resetCreateForm() }}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <h2 style={S.modalTitle}>🪄 铭刻新法术</h2>
              <button className="btn-icon" onClick={() => { setShowCreate(false); resetCreateForm() }}>✕</button>
            </div>
            <div style={S.modalBody}>
              <div className="form-row">
                <label>法术名称</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="输入技能名称…"
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label>简述</label>
                <input
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="一句话描述这个技能的用途…"
                />
              </div>
              <div className="form-row">
                <label>法术类别</label>
                <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as Category)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CAT_ICON[c]} {c}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>法术内容 <span className="form-hint">(Markdown)</span></label>
                <textarea
                  style={S.textarea}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder={'# 技能名称\n\n## 用途\n描述这个技能的作用…\n\n## 步骤\n1. 第一步\n2. 第二步\n\n## 注意事项\n- 要点一'}
                  rows={10}
                />
              </div>
            </div>
            <div style={S.modalFooter}>
              <button className="btn-small" onClick={() => { setShowCreate(false); resetCreateForm() }}>取消</button>
              <button
                className="btn-primary"
                onClick={handleCreate}
                disabled={saving || !newName.trim() || !newContent.trim()}
              >
                {saving ? '铭刻中…' : '💾 保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Skill Viewer Modal ── */}
      {viewingSkill && (
        <div style={S.overlay} onClick={() => { setViewingSkill(null); setViewContent('') }}>
          <div style={{ ...S.modal, maxWidth: '720px' }} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalHeader}>
              <h2 style={{ ...S.modalTitle, flex: 1 }}>📖 {viewingSkill.name}</h2>
              <span style={{ ...S.badge, color: CAT_COLOR[viewingSkill.category], borderColor: CAT_COLOR[viewingSkill.category] }}>
                {viewingSkill.category}
              </span>
              <button className="btn-icon" onClick={() => { setViewingSkill(null); setViewContent('') }}>✕</button>
            </div>
            <div style={S.modalBody}>
              <div style={S.viewerPath}>📁 {viewingSkill.path}</div>
              {viewLoading ? (
                <div className="empty-hint" style={{ textAlign: 'center' }}>加载法术内容…</div>
              ) : (
                <div
                  style={S.viewerContent}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(viewContent) }}
                />
              )}
            </div>
            <div style={S.modalFooter}>
              <button className="btn-small" onClick={() => { setViewingSkill(null); setViewContent('') }}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ── */}
      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  )
}

/* ─── 内联样式 ────────────────────────────────────────── */

const S: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: 'var(--bg-root)',
    color: 'var(--text-primary)',
    overflowY: 'auto',
    padding: '24px 28px',
    position: 'relative',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
    flexShrink: 0,
    gap: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--accent)',
    margin: 0,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 'var(--ui-font-size)',
    color: 'var(--text-secondary)',
    margin: 0,
  },
  headerActions: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexShrink: 0,
  },

  /* stats bar */
  statsBar: {
    display: 'flex',
    gap: 16,
    padding: '10px 16px',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    marginBottom: 20,
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  statItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 'calc(var(--ui-font-size) - 1px)',
  },
  statLabel: {
    color: 'var(--text-secondary)',
  },
  statCount: {
    fontWeight: 600,
    minWidth: 18,
    textAlign: 'center',
  },

  /* error */
  errorBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    background: 'var(--danger-soft)',
    border: '1px solid var(--danger-soft)',
    color: '#ff6680',
    padding: '8px 14px',
    borderRadius: 'var(--radius)',
    marginBottom: 14,
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    flexShrink: 0,
  },

  /* empty */
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 20px',
    flex: 1,
  },
  emptyIcon: {
    fontSize: 56,
    opacity: 0.5,
  },

  /* grid */
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
    gap: 12,
    alignContent: 'start',
  },

  /* card */
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardIcon: {
    fontSize: 20,
  },
  badge: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    padding: '2px 10px',
    borderRadius: 10,
    border: '1px solid',
    fontWeight: 500,
    lineHeight: '16px',
  },
  cardTitle: {
    fontSize: 'calc(var(--ui-font-size) + 2px)',
    fontWeight: 600,
    color: 'var(--text-primary)',
    margin: '0 0 6px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cardDesc: {
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    color: 'var(--text-secondary)',
    margin: '0 0 10px',
    flex: 1,
    lineHeight: 1.5,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  cardPath: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    marginBottom: 12,
    wordBreak: 'break-all',
    opacity: 0.7,
  },
  cardActions: {
    display: 'flex',
    gap: 8,
  },

  /* modal */
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'var(--overlay)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modal: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    width: '92%',
    maxWidth: 560,
    maxHeight: '82vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
  },
  modalHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  modalTitle: {
    fontSize: 'calc(var(--ui-font-size) + 3px)',
    fontWeight: 600,
    margin: 0,
    color: 'var(--text-primary)',
  },
  modalBody: {
    padding: 20,
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 20px',
    borderTop: '1px solid var(--border)',
    flexShrink: 0,
  },
  textarea: {
    width: '100%',
    background: 'var(--bg-root)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    padding: 10,
    borderRadius: 'var(--radius)',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    resize: 'vertical',
    outline: 'none',
    minHeight: 140,
    boxSizing: 'border-box',
  },

  /* viewer */
  viewerPath: {
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    color: 'var(--text-muted)',
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    marginBottom: 14,
    padding: '6px 12px',
    background: 'var(--bg-root)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)',
  },
  viewerContent: {
    fontSize: 'var(--ui-font-size)',
    lineHeight: 1.7,
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
    overflowWrap: 'break-word',
  },

  /* toast */
  toast: {
    position: 'fixed',
    bottom: 28,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--accent)',
    color: 'var(--text-primary)',
    padding: '10px 24px',
    borderRadius: 'var(--radius-lg)',
    fontSize: 'var(--ui-font-size)',
    zIndex: 300,
    boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
    whiteSpace: 'nowrap',
  },
}
