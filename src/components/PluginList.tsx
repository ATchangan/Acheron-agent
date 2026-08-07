// PluginList.tsx —— 插件列表与详情（从 PluginsView 拆出，行为不变）
import React from 'react'
import type { PluginInfo } from './plugin-types'
import { CATEGORIES, CATEGORY_HINT, CAT_COLORS, YELLOW_RIVER } from './plugin-types'
import { s } from './plugin-styles'
import { InfoMark, LockMark, ToolMark, BoltMark, TagMark } from './themed-icons'
import { U } from './ui-styles'

const DetailSection: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div>
    <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}>{icon}{title}</div>
    {children}
  </div>
)

const PluginDetail: React.FC<{ p: PluginInfo; onSetCategory: (name: string, cat: string) => void }> = ({ p, onSetCategory }) => {
  const perms = p.manifest.permissions || []
  const tools = p.manifest.tools || []
  const cmds = p.manifest.commands || []
  return (
    <div style={s.expandBody}>
      {/* 基本信息 */}
      <DetailSection icon={<InfoMark size={12} />} title="基本信息">
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {p.manifest.author && (<span>作者：{p.manifest.author}</span>)}
          {p.manifest.homepage && (
            <span>
              {' '}
              <a href={p.manifest.homepage} style={U.accent} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer">
                {p.manifest.homepage}
              </a>
            </span>
          )}
          {p.manifest.license && (<span>许可协议：{p.manifest.license}</span>)}
          <span>目录：{p.dirName}</span>
        </div>
      </DetailSection>

      {/* 权限 */}
      {perms.length > 0 && (
        <DetailSection icon={<LockMark size={12} />} title="权限">
          <div>
            {perms.map((perm) => <span key={perm} style={s.permChip}>{perm}</span>)}
          </div>
        </DetailSection>
      )}

      {/* 工具列表 */}
      {tools.length > 0 && (
        <DetailSection icon={<ToolMark size={12} />} title="提供工具">
          {tools.map((t, i) => (
            <div key={i} style={s.toolRow}>
              <span style={s.toolName}>{t.name}</span>
              <span style={U.textMuted}>— {t.description || '暂无说明'}</span>
            </div>
          ))}
        </DetailSection>
      )}

      {/* 命令列表 */}
      {cmds.length > 0 && (
        <DetailSection icon={<BoltMark size={12} />} title="命令">
          {cmds.map((c, i) => (
            <div key={i} style={s.toolRow}>
              <span style={s.toolName}>{c.name}</span>
              <span style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'calc(var(--ui-font-size) - 3px)' }}>
                {c.action}
              </span>
            </div>
          ))}
        </DetailSection>
      )}

      {/* 类别切换 */}
      <DetailSection icon={<TagMark size={12} />} title="类别">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(CATEGORIES).map(([key, val]) => (
            <button
              key={key}
              onClick={(e) => {
                e.stopPropagation()
                onSetCategory(p.manifest.name, key)
              }}
              style={{
                fontSize: 'calc(var(--ui-font-size) - 2px)',
                padding: '3px 10px',
                borderRadius: 14,
                border: `1px solid ${p.category === key ? CAT_COLORS[key] : 'var(--border)'}`,
                background: p.category === key ? `${CAT_COLORS[key]}20` : 'transparent',
                color: p.category === key ? CAT_COLORS[key] : 'var(--text-muted)',
                cursor: 'pointer',
                fontWeight: p.category === key ? 600 : 400,
              }}
            >
              {val.emoji} {val.label}
            </button>
          ))}
        </div>
      </DetailSection>
    </div>
  )
}

const PluginCard: React.FC<{
  p: PluginInfo
  isExpanded: boolean
  onToggle: (name: string) => void
  onExpand: (name: string | null) => void
  onSetCategory: (name: string, cat: string) => void
}> = ({ p, isExpanded, onToggle, onExpand, onSetCategory }) => {
  const cat = CATEGORIES[p.category] || CATEGORIES['oni']
  return (
    <div
      style={s.card}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = YELLOW_RIVER }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)' }}
    >
      {/* 卡片头部 */}
      <div style={s.cardHeader} onClick={() => onExpand(isExpanded ? null : p.manifest.name)}>
        <div style={s.cardLeft}>
          <div style={s.pluginIcon}>{cat.emoji}</div>
          <div style={{ minWidth: 0 }}>
            <div style={s.pluginName}>{p.manifest.name}</div>
            <div style={s.pluginMeta}>
              <span>v{p.manifest.version || '0.0.0'}</span>
              <span style={s.categoryBadge}>{cat.label}({CATEGORY_HINT[p.category]})</span>
            </div>
            <div style={U.ellipsis1}>{p.manifest.description || '暂无说明'}</div>
          </div>
        </div>
        <div style={U.flexGap8shrink}>
          <span
            className={`toggle ${p.enabled ? 'on' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle(p.manifest.name) }}
            title={p.enabled ? '禁用' : '启用'}
          />
          <span style={s.expandHint}>{isExpanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {isExpanded && <PluginDetail p={p} onSetCategory={onSetCategory} />}
    </div>
  )
}

export const PluginList: React.FC<{
  plugins: PluginInfo[]
  expanded: string | null
  onToggle: (name: string) => void
  onExpand: (name: string | null) => void
  onSetCategory: (name: string, cat: string) => void
}> = ({ plugins, expanded, onToggle, onExpand, onSetCategory }) => (
  <>
    {plugins.map((p) => (
      <PluginCard
        key={p.manifest.name}
        p={p}
        isExpanded={expanded === p.manifest.name}
        onToggle={onToggle}
        onExpand={onExpand}
        onSetCategory={onSetCategory}
      />
    ))}
  </>
)
