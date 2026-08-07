// SkillsView.tsx —— 技能精神录（状态编排；列表/新建/查看已拆至子组件）
import React, { useState, useEffect, useCallback } from 'react'
import { useChatStore } from '../store/chat'
import type { SkillMeta } from '../global'
import { errMsg } from '../utils/safe'
import { inferCategory, buildSkillPath, CATEGORIES, type Category, type SkillWithCategory } from './skills-utils'
import { S } from './skills-styles'
import { SkillList } from './SkillList'
import { SkillCreateForm, type SkillCreateState } from './SkillCreateForm'
import { SkillDetail } from './SkillDetail'

export default function SkillsView() {
  const [skills, setSkills] = useState<SkillWithCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  /* create form */
  const [showCreate, setShowCreate] = useState(false)
  const [createState, setCreateState] = useState<SkillCreateState>({ name: '', desc: '', category: '工作流', content: '' })
  const [saving, setSaving] = useState(false)

  /* viewer */
  const [viewingSkill, setViewingSkill] = useState<SkillWithCategory | null>(null)
  const [viewContent, setViewContent] = useState('')
  const [viewLoading, setViewLoading] = useState(false)

  /* toast */
  const [toast, setToast] = useState('')

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

  const closeViewer = () => { setViewingSkill(null); setViewContent('') }

  const handleCreate = async () => {
    if (!createState.name.trim() || !createState.content.trim()) return
    try {
      setSaving(true)
      const path = buildSkillPath(createState.name, createState.category)
      const header = [
        `# ${createState.name.trim()}`,
        '',
        `> **类别**: ${createState.category}  |  ${createState.desc.trim() || '暂无描述'}`,
        '',
        '---',
        '',
      ].join('\n')
      await window.huangquan.computer.writeFile(path, header + createState.content.trim())
      setShowCreate(false)
      setCreateState({ name: '', desc: '', category: '工作流', content: '' })
      await loadSkills()
      showToast(`✅ 法术「${createState.name.trim()}」已铭刻`)
    } catch (e: unknown) {
      setError(`保存失败: ${errMsg(e) || '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleXing = () => {
    try {
      useChatStore.getState().send('/xing 请从对话中提取可复用的技能，并以SKILL.md格式保存到skills/目录。')
      showToast('✨ 已发送提取指令到对话，请切换到聊天视图查看结果')
    } catch {
      showToast('⚠️ 无法发送指令，请手动在聊天中输入 /xing')
    }
  }

  const handleDelete = async (skill: SkillWithCategory) => {
    if (!confirm(`确定删除技能「${skill.name}」？`)) return
    try {
      const ok = await window.huangquan.skills.delete(skill.name)
      if (ok === true) { showToast(`已删除「${skill.name}」`); loadSkills() }
      else showToast('删除失败: ' + ok)
    } catch (e: unknown) { showToast('删除失败: ' + errMsg(e)) }
  }

  const stats = CATEGORIES.map((cat) => ({
    category: cat,
    count: skills.filter((s) => s.category === cat).length,
  }))
  const totalSkills = skills.length

  return (
    <div className="skills-root" style={S.container}>
      {/* Header */}
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

      <SkillList
        skills={skills}
        stats={stats}
        totalSkills={totalSkills}
        error={error}
        loading={loading}
        onView={handleView}
        onDelete={handleDelete}
        onClearError={() => setError('')}
      />

      {showCreate && (
        <SkillCreateForm
          state={createState}
          saving={saving}
          onChange={(patch) => setCreateState((s) => ({ ...s, ...patch }))}
          onSave={handleCreate}
          onCancel={() => { setShowCreate(false); setCreateState({ name: '', desc: '', category: '工作流', content: '' }) }}
        />
      )}

      {viewingSkill && (
        <SkillDetail
          skill={viewingSkill}
          content={viewContent}
          loading={viewLoading}
          onClose={closeViewer}
        />
      )}

      {toast && <div style={S.toast}>{toast}</div>}
    </div>
  )
}
