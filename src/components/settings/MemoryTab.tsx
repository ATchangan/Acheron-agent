import React from 'react'
import { useSettingsStore } from '../../store/settings'
import { S, Toggle } from '../settings-ui'
import { U } from '../ui-styles'


// v0.3.1 块 H: 记忆 tab(从 SettingsView 拆分, 行为零变化)
export default function MemoryTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  return (
    <div style={U.pageBody}>
      <div style={S.hint}>记忆内容（置顶 / 长期 / 摘要）在 <b>侧栏 → 记忆</b> 查看与编辑，此处仅调整记忆行为。</div>
      <div style={S.card}>
        <div style={S.section}>对话记忆（当前会话）</div>
        <div style={U.mt8}>
          {([['keepUserGoals', '始终保留用户核心目标和约束'], ['keepPendingTasks', '始终保留未完成待办事项'], ['keepDecisions', '始终保留重要决策和原因'], ['keepRecentRaw', '保留最近5条消息原文']] as const).map(([k, l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>短期记忆（会话内）</div>
        <Toggle checked={g.shortTermMemory !== false} onChange={v => save({ shortTermMemory: v })} label="记住会话偏好" hint="本会话中确认过的参数、路径、技术选型自动沿用" />
        <div style={S.label}>会话结束时</div>
        <select style={S.sel} value={g.sessionEndAction || 'clear'} onChange={e => save({ sessionEndAction: e.target.value })}>
          <option value="clear">自动清理（节省资源）</option>
          <option value="keep24h">保留 24 小时以便恢复</option>
        </select>
      </div>
      <div style={S.card}>
        <div style={S.section}>程序记忆（技能固化）</div>
        <Toggle checked={g.programMemory !== false} onChange={v => save({ programMemory: v })} label="启用技能识别" hint="任务完成后自动检测可复用模式" />
        <Toggle checked={g.autoSkill !== false} onChange={v => save({ autoSkill: v })} label="自动推荐固化" hint="关闭则每次需人工确认后才创建技能" />
        <div style={S.label}>推荐触发条件</div>
        <div style={S.hint}>流程≥{g.skillMinSteps || 3}步且无人工介入时推荐固化</div>
        <input type="number" style={S.inp} value={g.skillMinSteps || 3} min={2} max={10} onChange={e => save({ skillMinSteps: parseInt(e.target.value) || 3 })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>情景记忆（操作追溯）</div>
        <div style={S.label}>保留时间</div>
        <select style={S.sel} value={g.episodicRetention || '30d'} onChange={e => save({ episodicRetention: e.target.value })}><option value="7d">7 天</option><option value="30d">30 天</option><option value="90d">90 天</option></select>
        <Toggle checked={g.episodicRollback !== false} onChange={v => save({ episodicRollback: v })} label="支持操作回滚" hint="文件修改时自动生成备份" />
      </div>
    </div>
  )
}
