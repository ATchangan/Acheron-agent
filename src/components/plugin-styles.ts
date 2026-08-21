// v0.3.1 块 K: 插件页样式(从 PluginsView 拆出, 行为零变化)
import { YELLOW_RIVER } from './plugin-types'
export const s = {
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20,
  } as React.CSSProperties,
  statsBar: {
    display: 'flex', gap: 16, flexWrap: 'wrap' as const, marginBottom: 8,
  } as React.CSSProperties,
  statChip: {
    fontSize: 'calc(var(--ui-font-size) - 1px)', padding: '4px 12px', borderRadius: 20, border: `1px solid ${YELLOW_RIVER}`,
    color: 'var(--text-secondary)', background: 'rgba(var(--skin-accent),.08)', display: 'flex', alignItems: 'center', gap: 5,
  } as React.CSSProperties,
  actionRow: {
    display: 'flex', gap: 8, alignItems: 'center',
  } as React.CSSProperties,
  card: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: '14px 16px', marginBottom: 10, cursor: 'pointer', transition: 'all .15s',
  } as React.CSSProperties,
  cardHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  } as React.CSSProperties,
  cardLeft: {
    display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0,
  } as React.CSSProperties,
  pluginIcon: {
    width: 38, height: 38, borderRadius: 'var(--radius)',
    background: `linear-gradient(135deg, ${YELLOW_RIVER}, color-mix(in srgb, var(--accent) 60%, white))`,
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
    flexShrink: 0,
  } as React.CSSProperties,
  pluginName: {
    fontSize: 'calc(var(--ui-font-size) + 1px)', fontWeight: 600, color: 'var(--text-primary)',
  } as React.CSSProperties,
  pluginMeta: {
    fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)', marginTop: 2,
    display: 'flex', gap: 8, alignItems: 'center',
  } as React.CSSProperties,
  categoryBadge: {
    fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '1px 8px', borderRadius: 10, border: '1px solid',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  expandBody: {
    marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column' as const, gap: 12,
  } as React.CSSProperties,
  sectionTitle: {
    fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: 'var(--accent-purple)', textTransform: 'uppercase' as const,
    letterSpacing: '.5px', marginBottom: 4,
  } as React.CSSProperties,
  toolRow: {
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)',
    padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--bg-root)',
    marginBottom: 4,
  } as React.CSSProperties,
  toolName: {
    color: 'var(--accent)', fontFamily: "'JetBrains Mono', 'Consolas', monospace", fontSize: 'calc(var(--ui-font-size) - 2px)',
  } as React.CSSProperties,
  permChip: {
    fontSize: 'calc(var(--ui-font-size) - 3px)', padding: '2px 8px', borderRadius: 10, background: 'var(--bg-root)',
    color: 'var(--text-secondary)', border: '1px solid var(--border)',
    display: 'inline-flex', marginRight: 4, marginBottom: 4,
  } as React.CSSProperties,
  installForm: {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
    padding: 16, marginBottom: 16,
  } as React.CSSProperties,
  installTabs: {
    display: 'flex', gap: 4, marginBottom: 12,
  } as React.CSSProperties,
  installTab: (active: boolean): React.CSSProperties => ({
    padding: '4px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
    background: active ? YELLOW_RIVER : 'transparent',
    color: active ? '#fff' : 'var(--text-secondary)',
    cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: active ? 600 : 400,
    transition: 'all .12s',
  }),
  msgSuccess: {
    fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--success)', marginTop: 8,
  } as React.CSSProperties,
  msgError: {
    fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--danger)', marginTop: 8,
  } as React.CSSProperties,
  emptyIcon: {
    fontSize: 40, marginBottom: 12, opacity: 0.4,
  } as React.CSSProperties,
  expandHint: {
    fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', opacity: 0.6,
  } as React.CSSProperties,
}