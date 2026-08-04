import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, SegSetting } from '../settings-ui'
import type { MemoryData } from '../../global'

// v0.3.1 块 H: 记忆 tab(从 SettingsView 拆分, 行为零变化)
export default function MemoryTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [memF, setMemF] = useState<string[]>([])
  const [factsCount, setFactsCount] = useState(0)
  useEffect(() => {
    window.huangquan.memory.load().then((m) => { setMemF(m?.pinnedFacts || []); setFactsCount((m?.facts || []).length) }).catch(() => {})
  }, [])
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>工作记忆（对话内）</div>
        <div style={S.label}>压缩策略</div>
        <select style={S.sel} value={g.compactStrategy || 'auto'} onChange={e => save({ compactStrategy: e.target.value })}>
          <option value="auto">自动 — 达到阈值时触发</option>
          <option value="manual">手动 — 仅用户手动触发</option>
          <option value="off">关闭 — 溢出则截断</option>
        </select>
        <div style={S.row}><div style={S.label}>触发条件</div></div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}><div style={S.hint}>消息数超过</div><input type="number" style={S.inp} value={g.compactMsgCount || 20} onChange={e => save({ compactMsgCount: parseInt(e.target.value) || 20 })} /></div>
          <div style={{ flex: 1 }}><div style={S.hint}>Token 超过</div><input type="number" style={S.inp} value={g.compactTokenLimit || 50000} onChange={e => save({ compactTokenLimit: parseInt(e.target.value) || 50000 })} /></div>
        </div>
        <div style={S.row}><div style={S.label}>压缩强度</div></div>
        <SegSetting label="压缩强度" hint="压缩时保留原文的程度" value={g.compactStrength ?? 1} onChange={v => save({ compactStrength: v })} options={[{ v: 0, label: '保留细节' }, { v: 1, label: '平衡' }, { v: 2, label: '激进' }]} />
        <div style={S.hint}>{['保留更多原文，压缩比约30%', '平衡：保留关键信息，压缩比约50%', '仅保留核心结论，压缩比约80%'][g.compactStrength ?? 1]}</div>
        <div style={{ marginTop: 8 }}>
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
        <div style={S.hint}>跨会话持久化的事实，Agent 每次对话都会看到。按 Enter 添加。</div>
        <input style={{ ...S.inp, marginTop: 10, marginBottom: 12 }} placeholder="添加置顶事实..." onKeyDown={async e => { if (e.key !== 'Enter') return; const v = (e.target as HTMLInputElement).value; if (!v) return; const m = await window.huangquan.memory.load(); m.pinnedFacts = [...(m.pinnedFacts || []), v]; await window.huangquan.memory.save(m); setMemF([...(m.pinnedFacts || [])]); (e.target as HTMLInputElement).value = '' }} />
        {memF.length === 0 ? <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 2px)', textAlign: 'center', padding: 20 }}>暂无置顶记忆</div> : memF.map((f, i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: C.input, borderRadius: 7, marginBottom: 6 }}>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.text, flex: 1 }}>{f}</span>
          <button style={{ ...S.btn('danger'), height: 26, padding: '0 10px', fontSize: 'calc(var(--ui-font-size) - 3px)' }} onClick={async () => { const m = await window.huangquan.memory.load(); const pf = m.pinnedFacts || []; pf.splice(i, 1); m.pinnedFacts = pf; await window.huangquan.memory.save(m); setMemF([...(m.pinnedFacts || [])]) }}>删除</button>
        </div>)}
      </div>
      <div style={S.card}>
        <div style={S.section}>长期记忆</div>
        <div style={S.hint}>Agent 自动学习的事实和偏好。可浏览、搜索、删除。</div>
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
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
