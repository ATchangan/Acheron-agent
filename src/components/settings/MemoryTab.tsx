import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, SegSetting } from '../settings-ui'
import type { MemoryData } from '../../global'
import { U } from '../ui-styles'


// v0.3.1 块 H: 记忆 tab(从 SettingsView 拆分, 行为零变化)
export default function MemoryTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [memF, setMemF] = useState<string[]>([])
  const [factsCount, setFactsCount] = useState(0)
  const [summariesCount, setSummariesCount] = useState(0)
  useEffect(() => {
    window.huangquan.memory.load().then((m) => { setMemF(m?.pinnedFacts || []); setFactsCount((m?.facts || []).length); setSummariesCount((m?.summaries || []).length) }).catch(() => {})
  }, [])
  return (
    <div style={U.pageBody}>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 12, fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-secondary)' }} title="记忆占用：置顶永久保留，长期按相关度取用，摘要随时间衰减">
        <span>置顶 <b style={{ color: C.accent }}>{memF.length}</b>/10</span>
        <span>长期 <b style={{ color: C.accent }}>{factsCount}</b>/500</span>
        <span>摘要 <b style={{ color: C.accent }}>{summariesCount}</b>/200</span>
        <span style={{ color: C.muted }}>写满后旧内容会自动清理</span>
      </div>
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
      <div style={S.card}><div style={S.section}>置顶记忆</div>
        <div style={S.hint}>跨会话保存的事实，每次对话都会带上。按回车键添加。</div>
        <input style={{ ...S.inp, marginTop: 10, marginBottom: 12 }} placeholder="添加置顶事实..." onKeyDown={async e => { if (e.key !== 'Enter') return; const v = (e.target as HTMLInputElement).value; if (!v) return; const m = await window.huangquan.memory.load(); m.pinnedFacts = [...(m.pinnedFacts || []), v]; await window.huangquan.memory.save(m); setMemF([...(m.pinnedFacts || [])]); (e.target as HTMLInputElement).value = '' }} />
        {memF.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', textAlign: 'center', padding: 20 }}>暂无置顶记忆</div> : memF.map((f, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.input, borderRadius: 7, marginBottom: 6 }}>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.text, flex: 1 }}>{f}</span>
          <button style={{ ...S.btn('danger'), height: 26, padding: '0 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { const m = await window.huangquan.memory.load(); const pf = m.pinnedFacts || []; pf.splice(i, 1); m.pinnedFacts = pf; await window.huangquan.memory.save(m); setMemF([...(m.pinnedFacts || [])]) }}>删除</button>
        </div>)}
      </div>
      <div style={S.card}>
        <div style={S.section}>长期记忆</div>
        <div style={S.hint}>自动积累的事实和偏好，可浏览、搜索、删除。</div>
        <div style={U.rightMb8}>
          <button style={S.btn('ghost')} onClick={async () => {
            const m = await window.huangquan.memory.load().catch((): MemoryData => ({ facts: [], summaries: [], pinnedFacts: [] }))
            const facts = m.facts || []
            if (!facts.length) { alert('暂无长期记忆') }
            else { alert(facts.map((f: string, i: number) => (i + 1) + '. ' + f.slice(0, 200)).join('\n')) }
          }}>浏览全部 ({factsCount})</button>
          <button style={{ ...S.btn('danger'), marginLeft: 8 }} onClick={async () => {
            if (!confirm('清空全部长期记忆？此操作不可撤销。')) return
            const m = await window.huangquan.memory.load()
            m.facts = []; await window.huangquan.memory.save(m)
            alert('已清空')
          }}>清空全部</button>
        </div>
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
