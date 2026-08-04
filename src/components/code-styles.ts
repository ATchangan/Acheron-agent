// v0.3.1 块 K: 代码工坊样式(从 CodeView 拆出, 行为零变化)
import type { Lang } from './code-data'
export const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#17181c',
    color: 'var(--text-primary)',
    overflow: 'hidden',
  } as React.CSSProperties,

  header: {
    padding: '16px 20px 0',
    flexShrink: 0,
  } as React.CSSProperties,

  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,

  icon: { fontSize: '26px' } as React.CSSProperties,

  title: {
    fontSize: '18px',
    fontWeight: 600 as const,
    color: 'var(--text-primary)',
    margin: 0,
  } as React.CSSProperties,

  subtitle: {
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    color: 'var(--text-secondary)',
    marginTop: '2px',
  } as React.CSSProperties,

  /* ── 工具栏 ── */
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap' as const,
    paddingBottom: '10px',
    borderBottom: '1px solid #3a3c46',
  } as React.CSSProperties,

  langTab: (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    borderRadius: '5px',
    border: 'none',
    background: active ? 'rgba(var(--skin-accent),.20)' : 'transparent',
    color: active ? '#7c6fa8' : '#7777AA',
    cursor: 'pointer',
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    fontWeight: active ? (600 as const) : (400 as const),
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  }),

  toolbarSep: {
    width: '1px',
    height: '20px',
    background: '#3a3c46',
  } as React.CSSProperties,

  actionBtn: (color?: string): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: '5px',
    border: 'none',
    background: 'rgba(124,111,168,.12)',
    color: color || '#B8B8D0',
    cursor: 'pointer',
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  }),

  runBtn: {
    padding: '4px 16px',
    borderRadius: '5px',
    border: 'none',
    background: '#7c6fa8',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    fontWeight: 600 as const,
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  /* ── 主体: 上60%编辑器 / 下40%输出 ── */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    padding: '12px 20px',
  } as React.CSSProperties,

  editorPane: {
    flex: '6',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    marginBottom: '8px',
  } as React.CSSProperties,

  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    marginBottom: '6px',
  } as React.CSSProperties,

  editorLabel: {
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    color: 'var(--text-secondary)',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  editorWrap: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    overflow: 'hidden',
  } as React.CSSProperties,

  lineNumbers: {
    width: '44px',
    minWidth: '44px',
    background: '#1d1e24',
    borderRight: '1px solid #3a3c46',
    padding: '10px 4px 10px 0',
    overflow: 'hidden',
    textAlign: 'right' as const,
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    color: 'var(--text-muted)',
    lineHeight: '1.6',
    userSelect: 'none' as const,
    whiteSpace: 'pre' as const,
  } as React.CSSProperties,

  textarea: {
    flex: 1,
    background: '#23252b',
    border: 'none',
    color: 'var(--text-primary)',
    padding: '10px 14px',
    fontSize: 'var(--ui-font-size)',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    lineHeight: '1.6',
    resize: 'none' as const,
    outline: 'none',
    minHeight: 0,
    tabSize: 2,
  } as React.CSSProperties,

  /* ── 输出面板 ── */
  outputPane: {
    flex: '4',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
  } as React.CSSProperties,

  outputHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    marginBottom: '6px',
  } as React.CSSProperties,

  outputLabel: {
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    color: 'var(--text-secondary)',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  outputDuration: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    color: 'var(--accent)',
    marginLeft: '8px',
  } as React.CSSProperties,

  console: {
    flex: 1,
    background: '#0A0A16',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    padding: '10px 14px',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    color: 'var(--success)',
    lineHeight: '1.5',
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    minHeight: 0,
    margin: 0,
  } as React.CSSProperties,

  consolePlaceholder: {
    color: 'var(--text-muted)',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,

  /* ── 历史面板 ── */
  historyPanel: {
    background: '#23252b',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    marginTop: '8px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
    flexShrink: 0,
  } as React.CSSProperties,

  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    padding: '6px 12px',
    borderBottom: '1px solid #3a3c46',
    position: 'sticky' as const,
    top: 0,
    background: '#23252b',
    zIndex: 1,
  } as React.CSSProperties,

  historyTitle: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    color: 'var(--text-secondary)',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  historyClear: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    color: 'var(--text-muted)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,

  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 12px',
    borderBottom: '1px solid #262830',
    cursor: 'pointer',
    transition: 'all .1s',
    fontSize: 'calc(var(--ui-font-size) - 2px)',
  } as React.CSSProperties,

  historyLang: (lang: Lang): React.CSSProperties => {
    const colors: Record<Lang, string> = {
      python: '#4B8BBE',
      javascript: '#F0DB4F',
      typescript: '#3178C6',
      powershell: '#5391FE',
      bash: '#89E051',
    }
    return {
      fontSize: 'calc(var(--ui-font-size) - 3px)',
      padding: '1px 6px',
      borderRadius: '3px',
      background: 'rgba(0,0,0,.25)',
      color: colors[lang] || '#9999AA',
      fontWeight: 600 as const,
      whiteSpace: 'nowrap' as const,
      minWidth: '60px',
      textAlign: 'center' as const,
    }
  },

  historyCode: {
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    fontSize: 'calc(var(--ui-font-size) - 2px)',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
  } as React.CSSProperties,

  historyTime: {
    fontSize: 'calc(var(--ui-font-size) - 3px)',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  /* ── 模板下拉 ── */
  templateOverlay: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    zIndex: 10,
    background: '#262830',
    border: '1px solid #3a3c46',
    borderRadius: '8px',
    padding: '6px 0',
    minWidth: '200px',
    boxShadow: '0 8px 24px var(--overlay)',
    marginTop: '4px',
  } as React.CSSProperties,

  templateItem: {
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    color: 'var(--text-primary)',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    display: 'block',
    transition: 'all .08s',
  } as React.CSSProperties,

  /* ── Toast ── */
  toast: {
    position: 'fixed' as const,
    bottom: '20px',
    right: '20px',
    background: '#262830',
    border: '1px solid #7c6fa8',
    color: 'var(--text-primary)',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: 'calc(var(--ui-font-size) - 1px)',
    zIndex: 100,
    boxShadow: '0 4px 16px var(--overlay)',
    transition: 'opacity .2s',
  } as React.CSSProperties,
}
