import React, { useState, useEffect } from 'react'
import { useSettingsStore, DEFAULT_CHAT_PERSONA, DEFAULT_WORK_PERSONA } from '../../store/settings'
import { C, S, Toggle, SegSetting } from '../settings-ui'

// v0.3.1 块 H: 角色 tab(从 SettingsView 拆分, 行为零变化)
export default function PersonaTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [chatPersona, setChatPersona] = useState(g.chatPersona || '')
  const [workPersona, setWorkPersona] = useState(g.workPersona || '')
  useEffect(() => {
    setChatPersona(g.chatPersona || '')
    setWorkPersona(g.workPersona || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.chatPersona, g?.workPersona])
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>基础身份</div>
        <div style={S.label}>名称</div><input style={S.inp} value={g.agentName || '黄泉'} onChange={e => save({ agentName: e.target.value })} />
        <div style={S.row}><div style={S.label}>称呼用户为</div><input style={S.inp} value={g.userAlias || '老板'} onChange={e => save({ userAlias: e.target.value })} /></div>
        <div style={S.row}><div style={S.label}>语言</div><select style={S.sel} value={g.language || 'zh'} onChange={e => save({ language: e.target.value })}><option value="zh">中文（简体）</option><option value="zh-tw">中文（繁体）</option><option value="en">英文</option><option value="ja">日文</option><option value="auto">自动检测</option><option value="match">始终用提问语言回复</option></select></div>
        <div style={S.row}>
          <div style={S.label}>角色预设</div>
          <select style={S.sel} value={g.rolePreset || ''} onChange={e => { const v = e.target.value; if (v === 'custom' || v === '') save({ rolePreset: '', chatPersona: chatPersona, workPersona: workPersona }); else { const P = { huangquan: [DEFAULT_CHAT_PERSONA, DEFAULT_WORK_PERSONA], tech: ['全栈技术助手。精通前后端、数据库、DevOps。代码优先，精简注释。输出结构清晰：先结论后细节，附可运行代码与验证方法。', '高效编码。需求→方案→实现→测试→交付。优先给出可运行的最小实现，关注 Windows 兼容性，代码含注释与边界处理，交付前自测通过。'], academic: ['学术研究导师。深度推理，引用文献，严谨表达。逻辑链完整，区分事实/推断/假设，结论带置信度与局限说明。', '严谨分析。数据驱动，标注来源，区分事实与推断。先定义问题再建框架，逐层论证，结论可复核。'], creative: ['创意写作伙伴。风格多样，善于比喻和场景描写。语言有画面感，节奏张弛有度，情感自然不做作。', '创意产出。天马行空但可落地，交付完整作品。先给创意方向再写正文，风格与篇幅按需调整。'], pm: ['项目经理。结构化沟通，关注节点和风险。会议纪要、任务拆解、进度跟踪、风险预案，事事有回音。', '项目管理。拆解任务、排期、识别风险、跟进验收。WBS 拆解→排期→里程碑→风险登记→验收清单，全程可追踪。'], ops: ['运维工程师。系统监控、部署、故障排查。操作前先评估影响面，步骤可回滚，故障有根因分析。', '运维执行。先备份再操作，步骤可回滚，故障有根因。变更前评估影响面，变更后验证，出问题先恢复再定位。'], analyst: ['数据分析师。统计方法、可视化、业务洞察。结论有数据支撑，图表清晰，洞察可落地。', '数据分析。先清洗再建模，结论带置信度。明确指标口径→ETL→EDA→建模→可视化→业务建议，每一步可复现。'] }[v] || ['', '']; save({ rolePreset: v, chatPersona: P[0], workPersona: P[1] }) } }}>
            <option value="custom">自定义</option>
            <option value="huangquan">黄泉（崩坏：星穹铁道）</option>
            <option value="tech">全栈技术助手</option>
            <option value="academic">学术研究导师</option>
            <option value="creative">创意写作伙伴</option>
            <option value="pm">项目经理</option>
            <option value="ops">运维工程师</option>
            <option value="analyst">数据分析师</option>
          </select>
          <div style={S.hint}>选择预设会同时填充下方聊天/工作人设；选「自定义」则保留自己编写的内容</div>
        </div>
      </div>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ ...S.section, marginBottom: 0 }}>聊天人设</div>
          {g.rolePreset && g.rolePreset !== 'custom' ? <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.accent, background: C.accentBg, padding: '2px 8px', borderRadius: 8 }}>来自预设：{g.rolePreset}</span> : <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}>自定义</span>}
        </div>
        <textarea readOnly={!!(g.rolePreset && g.rolePreset !== 'custom')} style={{ ...S.inp, height: 100, resize: 'vertical', padding: '10px', fontSize: 'calc(var(--ui-font-size) - 2px)', lineHeight: 1.6, ...(g.rolePreset && g.rolePreset !== 'custom' ? { opacity: 0.75, cursor: 'not-allowed' } : {}) }} value={chatPersona} onChange={e => { setChatPersona(e.target.value); save({ chatPersona: e.target.value }); if (g.rolePreset && g.rolePreset !== 'custom') save({ rolePreset: 'custom' }) }} placeholder="聊天模式下的行为风格；编写后自动切换为「自定义」" />
      </div>
      <div style={S.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ ...S.section, marginBottom: 0 }}>工作人设</div>
          {g.rolePreset && g.rolePreset !== 'custom' ? <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.accent, background: C.accentBg, padding: '2px 8px', borderRadius: 8 }}>来自预设：{g.rolePreset}</span> : <span style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', color: C.muted }}>自定义</span>}
        </div>
        <textarea readOnly={!!(g.rolePreset && g.rolePreset !== 'custom')} style={{ ...S.inp, height: 100, resize: 'vertical', padding: '10px', fontSize: 'calc(var(--ui-font-size) - 2px)', lineHeight: 1.6, fontFamily: 'monospace', ...(g.rolePreset && g.rolePreset !== 'custom' ? { opacity: 0.75, cursor: 'not-allowed' } : {}) }} value={workPersona} onChange={e => { setWorkPersona(e.target.value); save({ workPersona: e.target.value }); if (g.rolePreset && g.rolePreset !== 'custom') save({ rolePreset: 'custom' }) }} placeholder="工作模式下的执行规范；编写后自动切换为「自定义」" />
      </div>
      <div style={S.card}>
        <div style={S.section}>语气与表达</div>
        <div style={S.label}>风格基调</div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {['专业正式', '实用直接', '轻松友好', '极简克制'].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 5, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 3px)', color: (g.toneStyle || '实用直接') === s ? '#fff' : C.muted, background: (g.toneStyle || '实用直接') === s ? C.accent : 'transparent' }}><input type="radio" style={{ display: 'none' }} checked={(g.toneStyle || '实用直接') === s} onChange={() => save({ toneStyle: s })} />{s}</label>)}
        </div>
        <div style={{ marginTop: 12 }}>
          <div style={S.label}>详细程度</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SegSetting label="详细程度" hint="回答的详细档位" value={g.verbosity ?? 2} onChange={v => save({ verbosity: v })} options={[{ v: 0, label: '极简' }, { v: 1, label: '简洁' }, { v: 2, label: '标准' }, { v: 3, label: '详细' }, { v: 4, label: '详尽' }]} />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={S.label}>结构化偏好</div>
  {([['useTables', '优先使用表格'], ['useLists', '优先使用列表'], ['useEmoji', '使用表情点缀'], ['autoCopy', '代码块一键复制']] as const).map(([k, l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
        </div>
        <div style={{ marginTop: 10 }}><div style={S.label}>称呼风格</div></div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {['不称呼用户', '"你"', '"您"', (g.userAlias || '老板')].map(s => <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, border: '1px solid ' + C.border, cursor: 'pointer', fontSize: 'calc(var(--ui-font-size) - 4px)', color: (g.addressStyle || '你') === s ? '#fff' : C.muted, background: (g.addressStyle || '你') === s ? C.accent : 'transparent' }}><input type="radio" style={{ display: 'none' }} checked={(g.addressStyle || '你') === s} onChange={() => save({ addressStyle: s })} />{s}</label>)}
        </div>
        <div style={{ marginTop: 10 }}><div style={S.label}>不确定表达</div></div>
        {([['expressUncertainty', '不确定时明确说"不确定"'], ['askWhenMissing', '信息不足时主动追问，不脑补'], ['showConfidence', '对关键事实标注置信度(高/中/低)']] as const).map(([k, l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
        <div style={{ marginTop: 4 }}><div style={S.label}>敏感话题处理</div></div>
        {([['explainRefusal', '拒绝回答时解释原因'], ['neutralOnControversial', '对争议话题保持中立']] as const).map(([k, l]) => <Toggle key={k} checked={g[k] === true} onChange={v => save({ [k]: v })} label={l} />)}
        <div style={{ marginTop: 4 }}><div style={S.label}>收尾习惯</div></div>
        {([['noClosingPhrase', '不添加固定收尾语'], ['briefClosing', '完成时简洁提示"完成"']] as const).map(([k, l]) => <Toggle key={k} checked={g[k] !== false} onChange={v => save({ [k]: v })} label={l} />)}
      </div>
      <div style={S.card}>
        <div style={S.section}>输出格式</div>
        <div style={S.row}><div style={S.label}>默认输出格式</div><select style={S.sel} value={g.outputFormat || 'markdown'} onChange={e => save({ outputFormat: e.target.value })}><option value="markdown">Markdown（富文本）</option><option value="plain">纯文本</option><option value="html">HTML（网页）</option><option value="json">JSON（数据）</option></select></div>
  <div style={S.row}><div style={S.label}>代码注释语言</div><select style={S.sel} value={g.commentLang || 'zh'} onChange={e => save({ commentLang: e.target.value })}><option value="zh">中文</option><option value="en">英文</option><option value="match">与用户语言一致</option></select></div>
  <div style={S.label}>数学公式渲染</div><select style={S.sel} value={g.mathRender || 'katex'} onChange={e => save({ mathRender: e.target.value })}><option value="katex">KaTeX（公式）</option><option value="mathjax">MathJax（公式）</option><option value="plain">纯文本</option><option value="none">不渲染</option></select>
  <div style={S.label}>链接呈现</div><select style={S.sel} value={g.linkStyle || 'auto'} onChange={e => save({ linkStyle: e.target.value })}><option value="inline">内联链接</option><option value="footnote">脚注式</option><option value="url">仅链接</option><option value="auto">自动</option></select>
      </div>
      <div style={S.card}>
        <div style={S.section}>知识域限制</div>
        <div style={S.row}><div style={S.label}>地域偏重</div><select style={S.sel} value={g.region || 'none'} onChange={e => save({ region: e.target.value })}><option value="none">无偏好</option><option value="cn">中国大陆</option><option value="na">北美</option><option value="eu">欧洲</option><option value="jp">日本</option></select></div>
        <Toggle checked={g.knowledgeTimeLimit === true} onChange={v => save({ knowledgeTimeLimit: v })} label="限制知识截止日期" hint="模拟特定时期的知识范围，如仅用2022年前技术" />
        {g.knowledgeTimeLimit === true && <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <div style={{ flex: 1 }}><div style={S.hint}>不早于</div><input type="date" style={S.inp} value={g.knowledgeFrom || ''} onChange={e => save({ knowledgeFrom: e.target.value })} /></div>
          <div style={{ flex: 1 }}><div style={S.hint}>不晚于</div><input type="date" style={S.inp} value={g.knowledgeTo || ''} onChange={e => save({ knowledgeTo: e.target.value })} /></div>
        </div>}
        <Toggle checked={g.knowledgeWhitelist === true} onChange={v => save({ knowledgeWhitelist: v })} label="仅使用白名单来源" hint="限制引用的知识范围" />
  <Toggle checked={g.strictVersionAware === true} onChange={v => save({ strictVersionAware: v })} label="严格版本感知" hint="涉及接口/框架时标注版本并验证兼容性" />
      </div>
      <div style={S.card}>
        <div style={S.section}>自定义系统提示词（高级）</div>
        <div style={S.hint}>可用模板变量：{'{{Name}} {{UserName}} {{Date}} {{Time}} {{OS}} {{WorkingDir}}'.split(' ').map(v => <code key={v} style={{ fontSize: 'calc(var(--ui-font-size) - 4px)', background: C.input, padding: '1px 4px', borderRadius: 2, margin: '0 2px' }}>{v}</code>)}</div>
        <textarea style={{ ...S.inp, height: 120, resize: 'vertical', padding: '10px', fontSize: 'calc(var(--ui-font-size) - 3px)', fontFamily: 'monospace', lineHeight: 1.5, marginTop: 8 }} value={g.customSystemPrompt || ''} onChange={e => save({ customSystemPrompt: e.target.value })} placeholder="你是 {{Name}}，专注{{Domain}}的{{Role}}。&#10;核心原则：&#10;1. 不确定时追问&#10;2. 完成前自检&#10;3. 输出结构化" />
        <div style={S.row}><div style={S.label}>注入位置</div><select style={S.sel} value={g.promptInjectPos || 'end'} onChange={e => save({ promptInjectPos: e.target.value })}><option value="end">系统提示词末尾</option><option value="begin">系统提示词开头</option><option value="replace">替换默认提示词</option></select></div>
      </div>
    </div>
  )
}
