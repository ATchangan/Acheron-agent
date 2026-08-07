// PluginList.tsx —— 插件列表与详情（从 PluginsView 拆出，行为不变）
import React from 'react'
import type { PluginInfo } from './plugin-types'
import { CATEGORIES, CATEGORY_HINT, CAT_COLORS, YELLOW_RIVER } from './plugin-types'
import { s } from './plugin-styles'
import { InfoMark, LockMark, ToolMark, BoltMark, TagMark } from './themed-icons'

export const PluginList: React.FC<{
  plugins: PluginInfo[]
  expanded: string | null
  onToggle: (name: string) => void
  onExpand: (name: string | null) => void
  onSetCategory: (name: string, cat: string) => void
}> = ({ plugins, expanded, onToggle, onExpand, onSetCategory }) => (
  <>
    {plugins.map((p) => {
      const cat = CATEGORIES[p.category] || CATEGORIES['oni']
      const isExpanded = expanded === p.manifest.name
      const catColor = CAT_COLORS[p.category] || CAT_COLORS['oni']

      return (
        <div
          key={p.manifest.name}
          style={s.card}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = YELLOW_RIVER
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
          }}
        >
          {/* 卡片头部 */}
          <div
            style={s.cardHeader}
            onClick={() => onExpand(isExpanded ? null : p.manifest.name)}
          >
            <div style={s.cardLeft}>
              <div style={s.pluginIcon}>{cat.emoji}</div>
              <div style={{ minWidth: 0 }}>
                <div style={s.pluginName}>{p.manifest.name}</div>
                <div style={s.pluginMeta}>
                  <span>v{p.manifest.version || '0.0.0'}</span>
                  <span style={s.categoryBadge}>
                    {cat.label}({CATEGORY_HINT[p.category]})
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 'calc(var(--ui-font-size) - 2px)',
                    color: 'var(--text-muted)',
                    marginTop: 3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.manifest.description || '暂无说明'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <span
                className={`toggle ${p.enabled ? 'on' : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(p.manifest.name)
                }}
                title={p.enabled ? '禁用' : '启用'}
              />
              <span style={s.expandHint}>
                {isExpanded ? '▲' : '▼'}
              </span>
            </div>
          </div>

          {/* 展开详情 */}
          {isExpanded && (
            <div style={s.expandBody}>
              {/* 基本信息 */}
              <div>
                <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}><InfoMark size={12} />基本信息</div>
                <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {p.manifest.author && (<span>作者：{p.manifest.author}</span>)}
                  {p.manifest.homepage && (
                    <span>
                      {' '}
                      <a href={p.manifest.homepage} style={{ color: 'var(--accent)' }} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer">
                        {p.manifest.homepage}
                      </a>
                    </span>
                  )}
                  {p.manifest.license && (<span>许可协议：{p.manifest.license}</span>)}
                  <span>目录：{p.dirName}</span>
                </div>
              </div>

              {/* 权限 */}
              {p.manifest.permissions && p.manifest.permissions.length > 0 && (
                <div>
                  <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}><LockMark size={12} />权限</div>
                  <div>
                    {p.manifest.permissions.map((perm) => (
                      <span key={perm} style={s.permChip}>{perm}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 工具列表 */}
              {p.manifest.tools && p.manifest.tools.length > 0 && (
                <div>
                  <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}><ToolMark size={12} />提供工具</div>
                  {p.manifest.tools.map((t, i) => (
                    <div key={i} style={s.toolRow}>
                      <span style={s.toolName}>{t.name}</span>
                      <span style={{ color: 'var(--text-muted)' }}>— {t.description || '暂无说明'}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* 命令列表 */}
              {p.manifest.commands && p.manifest.commands.length > 0 && (
                <div>
                  <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}><BoltMark size={12} />命令</div>
                  {p.manifest.commands.map((c, i) => (
                    <div key={i} style={s.toolRow}>
                      <span style={s.toolName}>{c.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontFamily: "'JetBrains Mono',monospace", fontSize: 'calc(var(--ui-font-size) - 3px)' }}>
                        {c.action}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* 类别切换 */}
              <div>
                <div style={{ ...s.sectionTitle, display: 'flex', alignItems: 'center', gap: 5 }}><TagMark size={12} />类别</div>
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
              </div>
            </div>
          )}
        </div>
      )
    })}
  </>
)
