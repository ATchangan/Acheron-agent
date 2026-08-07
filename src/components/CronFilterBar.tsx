// CronFilterBar.tsx —— 定时任务统计与过滤栏（从 CronView 拆出，行为不变）
import React from 'react'
import { FILTER_TABS, type FilterTab } from './cron-utils'
import { S } from './cron-styles'

export const CronFilterBar: React.FC<{
  filter: FilterTab
  stats: { total: number; enabled: number; disabled: number; today: number }
  onFilter: (f: FilterTab) => void
}> = ({ filter, stats, onFilter }) => (
  <>
    <div style={S.statsBar}>
      <span style={S.statChip}><span style={S.statNum}>{stats.total}</span>总计</span>
      <span style={S.statChip}><span style={S.statNum}>{stats.enabled}</span>已启用</span>
      <span style={S.statChip}><span style={S.statNum}>{stats.disabled}</span>已禁用</span>
      <span style={S.statChip}><span style={S.statNum}>{stats.today}</span>今日执行</span>
    </div>
    <div style={S.filterRow}>
      {FILTER_TABS.map((tab) => (
        <button
          key={tab.value}
          style={S.filterTab(filter === tab.value)}
          onClick={() => onFilter(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  </>
)
