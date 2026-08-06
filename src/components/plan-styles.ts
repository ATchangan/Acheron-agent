// v0.3.1 块 K: 计划页样式(从 PlanningView 拆出, 行为零变化)
import type { StepStatus, PlanStatus } from './plan-utils'

// ─── styles ───────────────────────────────────────────────
export const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: 'var(--bg-root)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
  },
  // header
  header: { padding: '20px 24px 0', flexShrink: 0 },
  titleRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  icon: { fontSize: '28px' },
  title: { fontSize: '20px', fontWeight: 600 as const, color: 'var(--text-primary)', margin: 0 },
  subtitle: { fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', marginTop: '2px' },
  // tabs
  navRow: {
    display: 'flex',
    gap: '4px',
    marginTop: '14px',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '8px',
  },
  navBtn: (active: boolean) => ({
    padding: '5px 14px',
    borderRadius: '6px',
    border: 'none',
    background: active ? 'rgba(var(--skin-accent),.15)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    fontWeight: active ? (600 as const) : (400 as const),
    transition: 'all .12s',
  }),
  // body
  body: { flex: 1, overflowY: 'auto' as const, padding: '0 24px 24px' },
  // cards
  card: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '16px',
    marginBottom: '10px',
  },
  cardSm: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '10px 14px',
    marginBottom: '6px',
    cursor: 'pointer',
    transition: 'border-color .15s',
  },
  // inputs
  input: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    fontSize: 'var(--ui-font-size)',
    outline: 'none',
    marginBottom: '8px',
  } as React.CSSProperties,
  textarea: {
    width: '100%',
    boxSizing: 'border-box' as const,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    padding: '8px 12px',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: '80px',
    fontFamily: 'inherit',
  },
  // buttons
  btn: (variant: 'primary' | 'danger' | 'ghost' | 'green', small?: boolean) => ({
    padding: small ? '4px 10px' : '7px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: small ? '11px' : '12px',
    fontWeight: 600 as const,
    transition: 'all .12s',
    background:
      variant === 'primary' ? 'var(--accent)'
      : variant === 'danger' ? 'var(--danger)'
      : variant === 'green' ? 'var(--success)'
      : 'transparent',
    color:
      variant === 'ghost' ? 'var(--text-secondary)' : 'var(--on-accent)',
    border: variant === 'ghost' ? '1px solid var(--border)' : 'none',
  }),
  // progress bar
  progressBarOuter: {
    height: '6px',
    background: 'var(--border)',
    borderRadius: '3px',
    margin: '8px 0',
    overflow: 'hidden',
  },
  progressBarInner: (pct: number) => ({
    height: '100%',
    width: `${pct}%`,
    background: pct < 100 ? 'var(--accent)' : 'var(--success)',
    borderRadius: '3px',
    transition: 'width .3s ease',
  }),
  // step card
  stepCard: (status: StepStatus) => ({
    background: 'var(--bg-card)',
    border: `1px solid ${
      status === 'completed' ? 'var(--success)'
      : status === 'in_progress' ? 'var(--accent)'
      : status === 'blocked' ? 'var(--danger)'
      : 'var(--border)'
    }`,
    borderRadius: '8px',
    padding: '12px 14px',
    marginBottom: '8px',
    transition: 'border-color .2s',
    position: 'relative' as const,
  }),
  stepHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '4px',
  },
  stepStatusBadge: (status: StepStatus) => ({
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 600 as const,
    background:
      status === 'completed' ? 'rgba(45,106,79,.20)'
      : status === 'in_progress' ? 'rgba(var(--skin-accent),.25)'
      : status === 'blocked' ? 'rgba(194,59,34,.20)'
      : 'rgba(153,153,170,.12)',
    color:
      status === 'completed' ? 'var(--success)'
      : status === 'in_progress' ? 'var(--accent)'
      : status === 'blocked' ? 'var(--danger)'
      : 'var(--text-secondary)',
    flexShrink: 0,
  }),
  stepTitle: (status: StepStatus) => ({
    fontSize: 'var(--ui-font-size)',
    fontWeight: 600 as const,
    color: status === 'completed' ? 'var(--text-secondary)' : 'var(--text-primary)',
    textDecoration: status === 'completed' ? 'line-through' : 'none',
  }),
  stepDesc: { fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: 1.5 },
  stepActions: {
    display: 'flex',
    gap: '4px',
    marginTop: '8px',
    flexWrap: 'wrap' as const,
  },
  // timeline connector
  timelineDot: (status: StepStatus) => ({
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
    background:
      status === 'completed' ? 'var(--success)'
      : status === 'in_progress' ? 'var(--accent)'
      : status === 'blocked' ? 'var(--danger)'
      : 'var(--border)',
    border: `2px solid ${
      status === 'completed' ? 'var(--success)'
      : status === 'in_progress' ? 'var(--accent)'
      : status === 'blocked' ? 'var(--danger)'
      : 'var(--text-muted)'
    }`,
    transition: 'all .25s',
  }),
  timelineLine: { width: '2px', height: '24px', background: 'var(--border)', marginLeft: '4px' },
  // labels
  label: { fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' } as React.CSSProperties,
  sectionTitle: {
    fontSize: 'var(--ui-font-size)',
    fontWeight: 600 as const,
    color: 'var(--text-primary)',
    margin: '16px 0 8px',
  },
  // notes
  notesArea: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    padding: '6px 8px',
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    color: 'var(--text-secondary)',
    marginTop: '6px',
    fontStyle: 'italic' as const,
  },
  // empty
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    color: 'var(--text-secondary)',
    gap: '12px',
  },
  emptyIcon: { fontSize: '48px', opacity: 0.4 },
  emptyText: { fontSize: 'var(--ui-font-size)', textAlign: 'center' as const, lineHeight: 1.6 },
  // template grid
  templateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: '10px',
  },
  templateCard: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '14px',
    cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
  },
  templateIcon: { fontSize: '24px', marginBottom: '6px' },
  templateTitle: { fontSize: 'var(--ui-font-size)', fontWeight: 600 as const, color: 'var(--text-primary)' },
  templateCount: { fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)', marginTop: '4px' },
  // plan card in history
  planCardStatus: (status: PlanStatus) => ({
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontWeight: 600 as const,
    background:
      status === 'active' ? 'rgba(var(--skin-accent),.25)'
      : status === 'paused' ? 'rgba(153,153,170,.15)'
      : status === 'completed' ? 'rgba(45,106,79,.20)'
      : 'rgba(153,153,170,.10)',
    color:
      status === 'active' ? 'var(--accent)'
      : status === 'paused' ? 'var(--text-secondary)'
      : status === 'completed' ? 'var(--success)'
      : 'var(--text-muted)',
    flexShrink: 0,
  }),
  // reorder indicators
  dragHandle: {
    cursor: 'grab',
    color: 'var(--text-muted)',
    fontSize: 'calc(var(--ui-font-size) + 1px)',
    padding: '0 4px',
    userSelect: 'none' as const,
  },
  confirmOverlay: {
    background: 'var(--bg-card)',
    border: '1px solid var(--danger)',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '8px',
  },
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

// ─── StepCard ──────────────────────────────────────────────
