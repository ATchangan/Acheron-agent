// CronTaskList.tsx —— 定时任务列表（从 CronView 拆出，行为不变）
import React, { useEffect, useState } from 'react'
import type { CronJob } from '../global'
import { exprLabel, relativeTime, countdown, fmtTime, type TaskMeta, type FilterTab } from './cron-utils'
import { S } from './cron-styles'
import { HourglassMark, AskMark, TrashMark } from './themed-icons'

export const CronTaskList: React.FC<{
  tasks: CronJob[]
  meta: TaskMeta
  filter: FilterTab
  loading: boolean
  delId: string | null
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onCancelDelete: () => void
  onConfirmDelete: (id: string) => void
}> = ({ tasks, meta, filter, loading, delId, onToggle, onDelete, onCancelDelete, onConfirmDelete }) => {
  // v0.3.6 P3-9: 倒计时 tick 下沉到列表内部, 不再让整个 CronView 每秒重渲染
  const [, setTick] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(iv)
  }, [])
  const filtered = tasks.filter((t) => {
    const m = meta[t.id]
    if (filter === 'enabled') return t.enabled
    if (filter === 'disabled') return !t.enabled
    if (filter === 'today') return m && m.lastRun ? new Date(m.lastRun).toDateString() === new Date().toDateString() : false
    return true
  })
  return (
    <>
      {loading && (
        <div style={S.empty}>加载中...</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={S.empty}>
          {filter === 'all'
  ? '轮回台中尚无任务，渡一叶舟入轮回吧'
  : '此筛选下空空如也'}
        </div>
      )}

      {delId && (() => {
        const t = tasks.find((x) => x.id === delId)
        return (
          <div style={S.confirmOverlay}>
            <div style={S.confirmText}>
              确认删除「{meta[delId]?.name || t?.expression || delId}」？此操作不可撤销。
            </div>
            <div style={S.confirmBtns}>
              <button style={S.btnConfirm} onClick={() => onConfirmDelete(delId)}>确认删除</button>
              <button style={S.btnCancel} onClick={onCancelDelete}>取消</button>
            </div>
          </div>
        )
      })()}

      {!loading && filtered.map((t) => {
        const m = meta[t.id] || { name: t.expression, lastRun: null as number | null }
        const displayName = m.name || t.expression
        const isEnabled = t.enabled

        return (
          <div key={t.id} style={S.card(isEnabled)}>
            <div style={S.cardHeader}>
              <div style={S.cardName}>
                <span style={S.statusDot(isEnabled)} />
                {displayName}
                {isEnabled && t.nextRun && (
                  <span style={{ ...S.countdownBadge, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <HourglassMark size={12} />{countdown(Number(t.nextRun) || 0)}
                  </span>
                )}
              </div>
              <div style={S.cardActions}>
                <button
                  style={S.toggle(isEnabled)}
                  onClick={() => onToggle(t.id)}
                  title={isEnabled ? '禁用' : '启用'}
                >
                  <div style={S.toggleKnob(isEnabled)} />
                </button>
                <button
                  style={S.btnDanger}
                  onClick={() => onDelete(t.id)}
                  title="删除"
                >
                  <TrashMark size={13} />
                </button>
              </div>
            </div>

            <div style={S.metaRow}>
              <div style={S.metaItem}>
                <span style={S.metaLabel}>表达式</span>
                <span style={S.metaValue}>{exprLabel(t.expression)}</span>
              </div>
              <div style={S.metaItem}>
                <span style={S.metaLabel}>下次</span>
                <span style={S.metaValue}>{t.nextRun ? fmtTime(Number(t.nextRun)) : '—'}</span>
                {t.nextRun && (
                  <span style={{ fontSize: '10px', color: 'var(--warning)' }}>
                    ({relativeTime(Number(t.nextRun) || 0)})
                  </span>
                )}
              </div>
              <div style={S.metaItem}>
                <span style={S.metaLabel}>上次</span>
                <span style={S.metaValue}>
                  {m.lastRun ? fmtTime(m.lastRun) : '未执行'}
                </span>
              </div>
              <div style={S.metaItem}>
                <span style={S.metaLabel}>状态</span>
                <span style={{ color: isEnabled ? 'var(--success)' : 'var(--text-secondary)', fontWeight: 600 }}>
                  {isEnabled ? '● 运行中' : '● 已停用'}
                </span>
              </div>
            </div>

            <div style={{ ...S.promptPreview, display: 'flex', alignItems: 'center', gap: 5 }} title={t.prompt}>
              <AskMark size={12} /> {t.prompt}
            </div>
          </div>
        )
      })}
    </>
  )
}
