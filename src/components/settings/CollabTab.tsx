import React, { useState } from 'react'
import { useSettingsStore } from '../../store/settings'
import { useChatStore } from '../../store/chat'
import { C, S, Toggle, NumSetting } from '../settings-ui'
import { errMsg } from '../../utils/safe'

// v0.3.1 块 H: 协作 tab(从 SettingsView 拆分, 行为零变化)
export default function CollabTab(props: {
  onNavigate: (page: string) => void
  setTab: (t: string) => void
  openWfModal: (name: string, desc: string) => void
}) {
  const { onNavigate, setTab, openWfModal } = props
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>多 Agent 协作模式</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 14 }}>
          {['自动', '手动', '关闭'].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 14px', borderRadius: 6, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 2px)', color: (g.collabMode || '自动') === s ? '#fff' : C.muted, background: (g.collabMode || '自动') === s ? C.accent : 'transparent' }}><input type="radio" style={{ display: 'none' }} checked={(g.collabMode || '自动') === s} onChange={() => save({ collabMode: s })} />{s}</label>)}
        </div>
        <NumSetting label="最大同时活跃 Agent" hint="" value={g.maxAgents || 5} min={1} max={10} unit="个" onChange={v => save({ maxAgents: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>编队成员</div>
        <div style={S.hint}>点击开关启用/禁用编队成员。关闭的Agent在对话中不可被 handoff 调用。</div>
        {[
          ['姬子', '☕', '总指挥官，任务分配与最终验收'],
          ['银狼', '🐺', '代码审查、安全审计、质量门禁'],
          ['螺丝咕姆', '🤖', '安全扫描、漏洞检测、代码加固'],
          ['艾丝妲', '📡', '前后端开发、调试、重构'],
          ['三月七', '📸', '数据清洗、记忆管理、上下文归档'],
          ['黑天鹅', '🦢', 'UI设计、图表绘制、视觉创意'],
          ['知更鸟', '🕊️', '代码生成、脚本编写、自动化'],
        ].map(([name, icon, desc]) => {
          const list = (g.disabledAgents || []) as string[]
          const on = !list.includes(name)
          return <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border }}>
            <div><span style={{ fontSize: 'var(--ui-font-size)' }}>{icon}</span><span style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 600, color: on ? C.text : C.muted, marginLeft: 6 }}>{name}</span><span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginLeft: 8 }}>{desc}</span></div>
            <div onClick={() => { const d = [...list]; if (on) d.push(name); else d.splice(d.indexOf(name), 1); save({ disabledAgents: d }) }} style={{ width: 36, height: 20, borderRadius: 10, background: on ? C.accent : C.border, cursor: 'pointer', position: 'relative', flexShrink: 0 }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 19 : 3 }} /></div>
          </div>
        })}
      </div>
      <div style={S.card}>
        <div style={S.section}>Handoff 交接规则</div>
        <Toggle checked={g.handoffContext !== false} onChange={v => save({ handoffContext: v })} label="传递完整上下文" hint="交接时带上需求背景、已有代码、约束条件" />
        <Toggle checked={g.handoffAutoReturn !== false} onChange={v => save({ handoffAutoReturn: v })} label="完成后自动交回" hint="被交接Agent完成任务后自动回到主Agent" />
        <div style={S.row}><div style={S.label}>最大连续交接次数</div><input type="number" style={S.inp} value={g.maxHandoffChain || 3} onChange={e => save({ maxHandoffChain: parseInt(e.target.value) || 3 })} /></div>
      </div>
      <div style={S.card}>
        <div style={S.section}>交叉验证</div>
        <Toggle checked={g.crossValidation === true} onChange={v => save({ crossValidation: v })} label="启用交叉验证" hint="关键任务由两个 Agent 独立执行后对比" />
        {g.crossValidation === true && <>
          <Toggle checked={g.cvCodeReview !== false} onChange={v => save({ cvCodeReview: v })} label="代码审查触发" hint="生成代码后自动触发" />
          <Toggle checked={g.cvSecurity !== false} onChange={v => save({ cvSecurity: v })} label="安全相关操作" />
          <Toggle checked={g.cvFinancial !== false} onChange={v => save({ cvFinancial: v })} label="涉及金钱/权限操作" />
          <div style={S.label}>验证方式</div>
          <select style={S.sel} value={g.cvMode || 'parallel'} onChange={e => save({ cvMode: e.target.value })}>
            <option value="parallel">并行验证（同时执行后对比）</option>
            <option value="serial">串行验证（执行→审查）</option>
          </select>
          <div style={S.label}>不一致处理</div>
          <select style={S.sel} value={g.cvConflictAction || 'report'} onChange={e => save({ cvConflictAction: e.target.value })}>
            <option value="report">汇报差异，由用户裁决</option>
            <option value="vote">Agent 自行投票决定</option>
            <option value="conservative">以更保守方案为准</option>
          </select>
        </>}
      </div>
      <div style={S.card}>
        <div style={S.section}>工作流模板</div>
        <div style={S.hint}>预定义的多步骤任务自动化流程（运行后自动切到对话执行）</div>
        {(() => {
          let custom: { name: string; id: string; desc?: string; steps?: number }[] = []
          try { custom = JSON.parse(localStorage.getItem('hq_custom_wfs') || '[]') } catch (e) { /* ignore */ console.debug('[swallow]', e) }
          const all: [string, string, string, number, boolean][] = [
            ['代码审查流程', 'code-review', '开发者提交→审查者审查→开发者修正', 3, false],
            ['部署检查清单', 'deploy-checklist', '检查配置→构建→测试→打包→...', 7, false],
            ['每日总结', 'daily-summary', '汇总今日工作+明日计划', 1, false],
            ...custom.map((c: { name: string; id: string; desc?: string; steps?: number }) => [c.name, 'custom-' + c.id, c.desc || '', c.steps || 1, true] as [string, string, string, number, boolean]),
          ]
          return all.map(([name, key, desc, steps, isCustom]: [string, string, string, number, boolean]) => <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid ' + C.border }}>
            <div><div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: C.text }}>{name}{isCustom ? <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}> · 自定义</span> : null}</div><div style={S.hint}>{desc}（{steps}步）</div></div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...S.btn('ghost'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 8px' }} onClick={() => { onNavigate('chat'); useChatStore.getState().send('执行工作流「' + name + '」：' + desc); showToast('工作流「' + name + '」已发送到对话执行') }}>运行</button>
              {isCustom ? <button style={{ ...S.btn('danger'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 8px' }} onClick={() => { const list = JSON.parse(localStorage.getItem('hq_custom_wfs') || '[]'); localStorage.setItem('hq_custom_wfs', JSON.stringify(list.filter((c: { id: string }) => 'custom-' + c.id !== key))); showToast('已删除自定义工作流'); setTab('collab'); }}>删除</button> : null}
            </div>
          </div>)
        })()}
        <div style={{ textAlign: 'right', marginTop: 8 }}><button style={S.btn('primary')} onClick={() => { openWfModal('', '') }}>+ 新建工作流</button></div>
      </div>
      <div style={S.card}>
        <div style={S.section}>已安装技能</div>
        <div style={S.hint}>可复用的知识/流程模块，由 Agent 自动学习或手动安装</div>
        {(() => {
          let removed: string[] = []
          try { removed = JSON.parse(localStorage.getItem('hq_removed_skills') || '[]') } catch (e) { /* ignore */ console.debug('[swallow]', e) }
          const list: string[][] = [
            ['Code Review', '内置', '代码审查流程、检查清单、最佳实践'],
            ['Project Manager', '内置', '项目进度追踪、里程碑管理、风险识别'],
            ['部署检查清单', '手动', '来源: GitHub/xxx/deploy-checklist'],
          ].filter(([n]) => !removed.includes(n))
          return list.length ? list.map(([name, src, desc]: string[]) => <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid ' + C.border }}>
            <div><span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: C.text }}>{name}</span><span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}> · {src}</span></div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button style={{ ...S.btn('ghost'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 6px' }} onClick={() => showToast(name + '：' + desc)}>查看</button>
              {src !== '内置' ? <button style={{ ...S.btn('danger'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 6px' }} onClick={() => { const r: string[] = JSON.parse(localStorage.getItem('hq_removed_skills') || '[]'); r.push(name); localStorage.setItem('hq_removed_skills', JSON.stringify(r)); showToast('已移除技能「' + name + '」'); setTab('collab'); }}>移除</button> : null}
            </div>
          </div>) : <div style={S.hint}>暂无技能，可安装</div>
        })()}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button style={S.btn('primary')} onClick={async () => { const url = prompt('GitHub 仓库地址（https://...）：'); if (!url) return; showToast('正在安装...'); const r = await window.huangquan.skills.install(url.trim()); showToast(String(r)) }}>从 GitHub 安装</button>
          <button style={S.btn('ghost')} onClick={async () => { try { const path = await window.huangquan.skills.pickLocal(); if (!path) return; showToast('正在安装...'); const r = await window.huangquan.skills.installLocal(path); showToast(String(r)) } catch (e: unknown) { showToast('安装失败: ' + errMsg(e)) } }}>从本地安装</button>
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
