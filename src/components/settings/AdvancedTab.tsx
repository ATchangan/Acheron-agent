import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, NumSetting } from '../settings-ui'
import { MoreHorizontal } from 'lucide-react'
import { U } from '../ui-styles'


// v0.3.1 块 H: 引擎 tab(从 SettingsView 拆分, 行为零变化)
export default function AdvancedTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const hidden = (name: string) => (g.hiddenSkills || []).includes(name)
  const [cronJobs, setCronJobs] = useState<{ id: string; trigger?: 'cron' | 'watch'; expression?: string; watchPath?: string; prompt: string; enabled: boolean }[] | null>(null)
  const [cronExpr, setCronExpr] = useState('')
  const [cronPrompt, setCronPrompt] = useState('')
  const [watchPath, setWatchPath] = useState('')
  const [watchPrompt, setWatchPrompt] = useState('')
  const [skills, setSkills] = useState<{ name: string; path: string; description: string; builtin: boolean }[]>([])
  const [skillStat, setSkillStat] = useState('')
  const [newSkillName, setNewSkillName] = useState('')
  const [newSkillDesc, setNewSkillDesc] = useState('')
  const [installUrl, setInstallUrl] = useState('')
  const refreshSkills = () => {
    void window.huangquan.skills.list().then(s => setSkills(s || [])).catch(() => setSkills([]))
    void window.huangquan.skills.stats(30).then(rows => {
      const top = rows.filter(r => r.hit + r.trigger > 0).slice(0, 3).map(r => r.name + ' 命中' + r.hit).join(' · ')
      setSkillStat(top)
    }).catch(() => setSkillStat(''))
  }
  useEffect(() => { refreshSkills() }, [])
  const refreshCron = () => { void window.huangquan.cron.list().then(j => setCronJobs(j)).catch(() => setCronJobs([])) }
  useEffect(() => {
    refreshCron()
  }, [])
  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>记忆系统</div>
        <div style={S.hint}>本地记忆网关(MemoryCore)：任务完成后自动沉淀对话经验；模型按需调用 记忆检索/对话检索/技能检索 工具。数据保存在本应用数据目录，不会上传。</div>
        <Toggle checked={g.memoryCoreEnabled !== false} onChange={v => save({ memoryCoreEnabled: v })} label="启用记忆系统" hint="关闭后模型无法使用 记忆/对话/技能 检索工具，也不再自动沉淀对话经验" />

      <div style={S.card}>
        <div style={S.section}>定时任务</div>
        <div style={S.hint}>到点自动执行指定任务（应用运行中有效，含托盘）。也可以直接对模型说“每天早上9点…”让它创建。表达式为 5 段 cron（分 时 日 月 周）。</div>
        {(cronJobs || []).map(j => (
          <div key={j.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + C.border }}>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: C.accent, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={j.trigger === 'watch' ? j.watchPath : j.expression}>{j.trigger === 'watch' ? '📂 ' + (j.watchPath || '') : j.expression}</span>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>{j.prompt}</span>
            <Toggle checked={j.enabled} onChange={async () => { await window.huangquan.cron.toggle(j.id); refreshCron() }} label={j.enabled ? '启用' : '停用'} />
            <button style={S.btn('ghost')} onClick={async () => { await window.huangquan.cron.remove(j.id); refreshCron() }}>删除</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={cronExpr} onChange={e => setCronExpr(e.target.value)} placeholder="0 9 * * *" style={{ width: 110, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', outline: 'none' }} />
          <input value={cronPrompt} onChange={e => setCronPrompt(e.target.value)} placeholder="要执行的任务内容…" style={{ flex: 1, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <button style={S.btn('ghost')} disabled={!cronExpr.trim() || !cronPrompt.trim()} onClick={async () => { const r = await window.huangquan.cron.add(cronExpr, cronPrompt); showToast(r.ok ? '已创建定时任务' : (r.error || '创建失败')); if (r.ok) { setCronExpr(''); setCronPrompt(''); refreshCron() } }}>添加</button>
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={watchPath} onChange={e => setWatchPath(e.target.value)} placeholder="监控路径（文件夹或文件）…" style={{ flex: 1, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <input value={watchPrompt} onChange={e => setWatchPrompt(e.target.value)} placeholder="变化时要执行的任务…" style={{ flex: 1, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <button style={S.btn('ghost')} disabled={!watchPath.trim() || !watchPrompt.trim()} onClick={async () => { const r = await window.huangquan.cron.addWatch(watchPath, watchPrompt); showToast(r.ok ? '已创建文件监控' : (r.error || '创建失败')); if (r.ok) { setWatchPath(''); setWatchPrompt(''); refreshCron() } }}>添加监控</button>
        </div>
        </div>
      </div>

      <div style={S.card}>
        <div style={S.section}>技能</div>
        <div style={S.hint}>技能在命中触发词时注入系统提示；取消勾选即隐藏（引擎不再注入，但仍可通过技能工具读取）。</div>
        {(skills || []).map(s2 => {
          const hidden = (g.hiddenSkills || []).includes(s2.name)
          return (
            <div key={s2.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
              <Toggle checked={!hidden} onChange={v => save({ hiddenSkills: v ? (g.hiddenSkills || []).filter(x => x !== s2.name) : [...(g.hiddenSkills || []), s2.name] })} label={s2.name + (s2.builtin ? '（内置）' : '')} hint={s2.description.slice(0, 120)} />
            </div>
          )
        })}
        {skillStat && <div style={S.hint}>近 30 天使用：{skillStat}</div>}
        {skills.map(s2 => (
          <div key={s2.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <Toggle checked={!hidden(s2.name)} onChange={v => save({ hiddenSkills: v ? (g.hiddenSkills || []).filter(x => x !== s2.name) : [...(g.hiddenSkills || []), s2.name] })} label={s2.name + (s2.builtin ? '（内置）' : '')} hint={s2.description.slice(0, 120)} />
            {!s2.builtin && <button style={S.btn('ghost')} title="删除技能" onClick={async () => { await window.huangquan.skills.remove(s2.name); showToast('已删除 ' + s2.name); refreshSkills() }}>删除</button>}
          </div>
        ))}
        {!skills.length && <div style={S.hint}>暂无技能。可从 Git 仓库安装，或在数据目录 skills/ 放置含 SKILL.md 的文件夹。</div>}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
          <input value={installUrl} onChange={e => setInstallUrl(e.target.value)} placeholder="Git 仓库地址（https://…/skill.git）" style={{ flex: 1, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <button style={S.btn('ghost')} disabled={!installUrl.trim()} onClick={async () => { showToast('安装中…'); const r = await window.huangquan.skills.install(installUrl); showToast(String(r)); setInstallUrl(''); refreshSkills() }}>安装</button>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
          <input value={newSkillName} onChange={e => setNewSkillName(e.target.value)} placeholder="技能名（字母数字-）" style={{ width: 160, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <input value={newSkillDesc} onChange={e => setNewSkillDesc(e.target.value)} placeholder="用途描述…" style={{ flex: 1, height: 28, padding: '0 8px', background: C.card, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, fontSize: 12, outline: 'none' }} />
          <button style={S.btn('ghost')} disabled={!newSkillName.trim() || !newSkillDesc.trim()} onClick={async () => {
            const name = newSkillName.trim()
            const content = [
              '---',
              'name: ' + name,
              'description: ' + newSkillDesc.trim(),
              'triggers: []',
              'tools: []',
              '---',
              '',
              '## 步骤',
              '1. （在此补充执行步骤）',
              '',
            ].join('\n')
            const r = await window.huangquan.skills.create(name, content)
            showToast(String(r))
            if (String(r).startsWith('ok')) { setNewSkillName(''); setNewSkillDesc(''); refreshSkills() }
          }}>创建</button>
        </div>
      </div>
        <NumSetting label="网关端口" hint="默认 8420；修改后需重启应用生效" value={g.memoryCorePort ?? 8420} min={1024} max={65535} unit="" onChange={v => save({ memoryCorePort: v })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button style={S.btn('ghost')} onClick={async () => { try { const st = await window.huangquan?.memoryCore?.status(); if (st) alert('记忆网关状态：\n' + st.status + (st.detail ? '\n' + st.detail : '') + (st.baseUrl ? '\n' + st.baseUrl : '')) } catch { /* 忽略 */ } }}>查看网关状态</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>渲染加速</div>
        <div style={S.hint}>自动识别电脑显卡：能用硬件加速就用，不能用就改用软件渲染，无需手动设置。切换后需重启应用生效。</div>
        <div style={S.row}><div style={S.label}>渲染模式</div><select style={S.sel} value={g.rendererMode || 'auto'} onChange={e => save({ rendererMode: e.target.value })}>
          <option value="auto">自动识别（推荐，自动探测显卡）</option><option value="gpu">强制显卡加速</option><option value="cpu">软件渲染（兼容）</option>
        </select></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button style={S.btn('ghost')} onClick={async () => { try { const st = await window.huangquan?.web.rendererStatus(); if (st) alert('渲染状态：\n模式：' + st.mode + '\n显卡加速：' + st.gpuAcceleration + '\nWebGL：' + st.webgl + '\n画布渲染：' + st.canvas2d) } catch { /* 忽略 */ } }}>查看当前渲染状态</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>执行控制</div>
        <NumSetting label="失败重试次数" hint="单个工具失败后重试次数（0=不重试）" value={g.retryCount ?? 3} min={0} max={10} unit="次" onChange={v => save({ retryCount: v })} />
        <Toggle checked={g.parallelTools !== false} onChange={v => save({ parallelTools: v })} label="并行工具执行" hint="读取类工具（读取/列出/搜索等）并发执行，减少等待时间" />
        <Toggle checked={g.restoreLastSession === true} onChange={v => save({ restoreLastSession: v })} label="启动时恢复上次会话" hint="开启后启动直接回到上次使用的会话；关闭则每次新建对话（历史会话仍在侧栏）" />
      </div>
      <div style={S.card}>
        <div style={S.section}>长任务</div>
        <div style={S.hint}>长程执行（多轮工具 / 并行子任务）的轮次、超时与预算护栏；无进展停滞仅提示、可手动继续/中止，不自动停止。</div>
        <NumSetting label="工具调用上限" hint="初始上限，任务仍在推进时自动顺延，直到任务完成" value={g.maxToolRounds || 50} min={5} max={200} unit="轮" onChange={v => save({ maxToolRounds: v })} />
        <NumSetting label="工具超时" hint="单工具/子任务无进展判定阈值，不设总时长上限" value={g.toolTimeout || 120} min={10} max={600} unit="秒" onChange={v => save({ toolTimeout: v })} />
        <NumSetting label="熔断阈值" hint="同一操作反复触发到上限时自动停止" value={g.meltdownLimit || 3} min={1} max={10} unit="次" onChange={v => save({ meltdownLimit: v })} />
        <NumSetting label="单任务 token 预算" hint="0=不限；任务累计输入/输出/缓存写入 token 达到上限后本轮提前结束，防止失控花费" value={g.maxTaskTokens || 0} min={0} max={1000000} unit="token" onChange={v => save({ maxTaskTokens: v })} />
        <Toggle checked={g.longTaskAutoContinue === true} onChange={v => save({ longTaskAutoContinue: v })} label="长任务预算耗尽后自动继续" hint="开启后达到预算自动重置已用量续跑；关闭则达到预算直接结束本轮" />
        <NumSetting label="自动继续次数上限" hint="自动续跑的轮数上限，超过后结束本轮" value={g.longTaskAutoMax || 5} min={1} max={20} unit="次" onChange={v => save({ longTaskAutoMax: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>任务可靠性</div>
        <Toggle checked={g.riskConfirm !== false} onChange={v => save({ riskConfirm: v })} label="风险操作确认" hint="执行命令/删除文件等 L2-L3 操作前弹原生确认框；关闭后静默放行" />
        <NumSetting label="项目指令上限" hint="AGENTS.md 等按目录链合并注入的字节上限（KB，默认 32）；超限截断并打标记，可拆到子目录绕开" value={g.projectDocMaxKb || 32} min={4} max={512} unit="KB" onChange={v => save({ projectDocMaxKb: v })} />
        <NumSetting label="同时运行任务上限" hint="多会话并发保护：同时运行的任务数达到上限后新任务会提示等待（默认 3）" value={g.maxConcurrentTasks || 3} min={1} max={10} unit="个" onChange={v => save({ maxConcurrentTasks: v })} />
        <div style={S.row}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: 'var(--text-primary)' }}>事件钩子（Hooks）</div>
            <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: 'var(--text-muted)', marginTop: 4 }}>每行 事件=命令，可用变量 HQ_EVENT/HQ_TOOL/HQ_SID/HQ_TASK_ID/HQ_RESULT/HQ_PATH/HQ_STATUS/HQ_KIND/HQ_FROM/HQ_TO；事件：tool-before、tool-after、task-start、task-end、file-write、task-stop、task-resume、compact-before、model-fallback；含中文路径/输出的命令会自动走 PowerShell（UTF-8），无需手动加前缀</div>
            <textarea
              value={g.hooksText || ''}
              onChange={e => save({ hooksText: e.target.value })}
              placeholder={'# tool-after=echo [hook] $env:HQ_TOOL 完成\ntask-start=echo 任务开始'}
              style={{ width: '100%', minHeight: 66, marginTop: 6, padding: '8px 10px', background: 'var(--bg-root)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 'calc(var(--ui-font-size) - 2px)', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <Toggle checked={g.traceEnabled !== false} onChange={v => save({ traceEnabled: v })} label="本地诊断轨迹" hint="记录任务/LLM/工具调用链，可在 设置→诊断 查看；仅存本地" />
        <Toggle checked={g.mcpAutoInject !== false} onChange={v => save({ mcpAutoInject: v })} label="MCP 工具自动注入" hint="连接过的 MCP 服务器工具 schema 自动并入模型工具列表，无需手动 mcp_call" />
        <Toggle checked={g.planGate === true} onChange={v => save({ planGate: v })} label="计划确认门（实验）" hint="首次调用工具前先展示执行计划，等你批准后再动手" />
        <Toggle checked={g.llmSummary === true} onChange={v => save({ llmSummary: v })} label="LLM 摘要压缩（实验）" hint="长会话早期消息交给模型压缩成要点，替代规则截断（消耗少量 token）" />
        <Toggle checked={g.microCompact !== false} onChange={v => save({ microCompact: v })} label="微压缩（每轮小步）" hint="默认开启：每轮结束后把最旧一组问答折进运行摘要，分摊压缩成本，避免一次性大压缩停顿；关闭后回到一次性压缩" />
      </div>
      <div style={S.card}>
        <div style={S.section}>缓存管理</div>
        <Toggle checked={g.autoCleanCache !== false} onChange={v => save({ autoCleanCache: v })} label="自动清理 Chromium 缓存" hint="启动时若 Cache/Code Cache/GPU 缓存超过阈值则自动清空（默认开启）" />
        <NumSetting label="清理阈值" hint="缓存总大小超过该值(MB)时自动清理" value={g.autoCleanCacheSize || 200} min={50} max={5000} unit=" MB" onChange={v => save({ autoCleanCacheSize: v })} />
        <div style={U.centerGap8mt6}>
          <button style={S.btn('ghost')} onClick={async () => {
            try {
              const r = await window.huangquan.cacheCleanChromium()
              showToast('已清理 ' + r.freedMb + 'MB（缓存共 ' + r.totalMb + 'MB）')
            } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
          }}>立即清理</button>
          <span style={U.fs2muted}>清理后可释放磁盘空间，应用会自动重建缓存</span>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>流量与性能</div>
        <div style={S.hint}>以下优化默认开启，可单独关闭；关闭后相关功能回到旧行为。</div>
        <div style={S.hint}>当前开启 {9 - Object.values(g.perf || {}).filter(v => v === false).length}/9 项</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', alignItems: 'start' }}>
          <Toggle checked={g.perf?.toolWhitelist !== false} onChange={v => save({ perf: { ...(g.perf || {}), toolWhitelist: v } })} label="按任务精简工具" hint="不同任务只展示用得到的工具" />
          <Toggle checked={g.perf?.resultSlim !== false} onChange={v => save({ perf: { ...(g.perf || {}), resultSlim: v } })} label="长内容精简" hint="过长结果只保留开头结尾和关键信息" />
          <Toggle checked={g.perf?.compactSummary !== false} onChange={v => save({ perf: { ...(g.perf || {}), compactSummary: v } })} label="窗口阈值压缩" hint="真实用量接近模型窗口上限时，把旧轮次总结成摘要保留关键信息" />
          <Toggle checked={g.perf?.outputCap !== false} onChange={v => save({ perf: { ...(g.perf || {}), outputCap: v } })} label="简短回复限长" hint="简单闲聊限制回答长度" />
          <Toggle checked={g.perf?.imgDowngrade !== false} onChange={v => save({ perf: { ...(g.perf || {}), imgDowngrade: v } })} label="旧图片不重复发送" hint="历史图片只发一次，需要时再取" />
          <Toggle checked={g.perf?.argSlim !== false} onChange={v => save({ perf: { ...(g.perf || {}), argSlim: v } })} label="长参数精简" hint="过长的工具参数只保留关键部分" />
          <Toggle checked={g.perf?.taskArchive !== false} onChange={v => save({ perf: { ...(g.perf || {}), taskArchive: v } })} label="任务记录自动归档" hint="完成任务自动归档，跨任务引用不丢" />
          <Toggle checked={g.perf?.parallelCap !== false} onChange={v => save({ perf: { ...(g.perf || {}), parallelCap: v } })} label="并行结果精简" hint="同时返回过多结果时自动精简" />
          <Toggle checked={g.perf?.interjectMerge !== false} onChange={v => save({ perf: { ...(g.perf || {}), interjectMerge: v } })} label="连续插话合并" hint="连续补充的指令合并成一条" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button style={S.btn('ghost')} onClick={() => { save({ perf: {} }); showToast('已恢复全部默认（全开）') }}>恢复默认</button>
          <span style={U.fs2muted}>改动即时生效并自动保存</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', marginTop: 10 }}>
          <NumSetting label="保留最近轮数" hint="窗口压缩时保留多少轮完整上下文" value={g.compactKeepRounds || 6} min={2} max={20} unit=" 轮" onChange={v => save({ compactKeepRounds: v })} />
          <NumSetting label="压缩触发阈值" hint="真实输入用量达到模型窗口的此比例时触发压缩" value={Math.round((g.compactThreshold || 0.7) * 100)} min={30} max={95} unit="%" onChange={v => save({ compactThreshold: v / 100 })} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', marginTop: 8 }}>
          <NumSetting label="绝对触发阈值" hint="0=禁用；设置后到达该 token 数必压（不晚于此值）" value={g.compactTokenCap || 0} min={0} max={2000000} unit=" tokens" onChange={v => save({ compactTokenCap: v })} />
          <div>
            <div style={S.label}>按模型覆盖阈值</div>
            <textarea
              style={{ ...S.inp, height: 52, resize: 'vertical', fontFamily: 'monospace', fontSize: 'calc(var(--ui-font-size) - 3px)', lineHeight: 1.4 }}
              placeholder={'模型名=百分比，每行一个，例如：\ndeepseek-v4-flash=85\ngpt-5=60'}
              defaultValue={Object.entries(g.compactOverrides || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
              onBlur={e => {
                const next: Record<string, number> = {}
                for (const line of e.target.value.split('\n')) {
                  const idx = line.indexOf('=')
                  if (idx <= 0) continue
                  const k = line.slice(0, idx).trim()
                  const v = Number(line.slice(idx + 1).trim())
                  if (k && v > 0 && v <= 100) next[k] = v
                }
                save({ compactOverrides: next })
              }}
            />
            <div style={S.hint}>仅对指定模型生效，留空则全部使用上方全局阈值</div>
          </div>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>交互与显示</div>
        <Toggle checked={g.singleBubble !== false} onChange={v => save({ singleBubble: v })} label="合并为一条回复" hint="整轮任务合并为一条消息；关闭后每一步单独显示" />
        <NumSetting label="卡片最大高度" hint="卡片类内容的最大高度" value={g.cardMaxHeight || 500} min={100} max={2000} unit="px" onChange={v => save({ cardMaxHeight: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>路径与权限</div>
        <div style={S.label}>工作目录</div>
        <div style={S.hint}>默认读写文件的根目录</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, position: 'relative' }}>
          <input style={{ ...S.inp, flex: 1 }} value={g.workDir || ''} placeholder="如 D:\桌面\桌面工作台" onChange={e => save({ workDir: e.target.value })} />
          <span style={{ flexShrink: 0, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }} title="选择工作目录" onClick={async () => { const path = await window.huangquan.computer.selectDir(); if (path) save({ workDir: path }) }}><MoreHorizontal size={16} /></span>
        </div>
        <div style={{ marginTop: 14 }}><div style={S.label}>文件操作权限</div><div style={S.hint}>控制对文件系统的操作范围</div></div>
        <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.filePermission || 'full'} onChange={e => save({ filePermission: e.target.value })}>
          <option value="full">完整权限 — 读写执行均可</option>
          <option value="ask">操作前询问 — 写/删操作需人工确认</option>
          <option value="readonly">只读 — 仅允许读取，禁止写入/删除/执行</option>
          <option value="sandbox">工作区沙箱 — 仅限工作目录内操作</option>
        </select>
      </div>
      <div style={S.card}>
        <div style={S.section}>日志与调试</div>
        <div style={S.label}>日志级别</div>
        <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.logLevel || 'info'} onChange={e => save({ logLevel: e.target.value })}>
          <option value="debug">调试 — 全部日志（含工具调用详情）</option>
          <option value="info">信息 — 常规信息（默认）</option>
          <option value="warn">警告 — 仅警告和错误</option>
          <option value="error">错误 — 仅错误</option>
        </select>
        <Toggle checked={g.devTools !== false} onChange={v => save({ devTools: v })} label="开发者工具" hint="启动时自动打开调试工具" />
      </div>
      <div style={S.card}>
        <div style={S.section}>网络与代理</div>
        <div style={S.label}>代理模式</div>
        <select style={{ ...S.sel, width: '100%' }} value={g.proxyMode || 'none'} onChange={e => save({ proxyMode: e.target.value })}>
          <option value="system">使用系统代理</option>
          <option value="none">不使用代理</option>
          <option value="custom">自定义代理</option>
        </select>
        {g.proxyMode === 'custom' && <><input style={{ ...S.inp, marginTop: 8 }} placeholder="http://127.0.0.1:7890" value={g.proxyUrl || ''} onChange={e => save({ proxyUrl: e.target.value })} /><div style={S.hint}>HTTP/HTTPS 代理地址</div></>}
        <div style={S.row}><div style={S.label}>连接超时</div><input type="number" style={S.inp} value={g.connectTimeout || 30} onChange={e => save({ connectTimeout: parseInt(e.target.value) || 30 })} /></div>
      </div>
      <div style={S.card}>
        <div style={S.section}>数据管理</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderTop: '1px solid ' + C.border }}>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: C.muted }}>工具缓存命中率(总)</div>
          <div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', fontWeight: 700, color: 'var(--success)' }}>{g.stat_cacheRate || '—'} <span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, fontWeight: 400 }}>({g.stat_cacheHits || 0} 命中 / {g.stat_cacheMisses || 0} 未中)</span></div>
        </div>
        <div style={U.rightMb8}>
          <button style={{ ...S.btn('ghost'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 8px' }} onClick={async () => { try { const s = await window.huangquan.storageStats(); const patch: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; const cs = await window.huangquan.cacheStats(); patch['stat_cacheHits'] = cs?.hits || 0; patch['stat_cacheMisses'] = cs?.misses || 0; patch['stat_cacheRate'] = cs?.hit_rate || '0%'; save(patch); showToast('已刷新') } catch { showToast('统计失败') } }}>刷新</button>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          <button style={S.btn('ghost')} onClick={async () => { try { await window.huangquan.cacheClear(); showToast('缓存已清除'); const s = await window.huangquan.storageStats(); const patch: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; save(patch) } catch { showToast('清除失败') } }}>清除缓存</button>
          <button style={S.btn('danger')} onClick={async () => { if (!confirm('确定清空全部对话历史？此操作不可恢复')) return; try { await window.huangquan.sessions.clearAll(); showToast('对话历史已清空'); window.location.reload() } catch { showToast('操作失败') } }}>清除对话历史</button>
          <button style={S.btn('danger')} onClick={async () => { if (!confirm('恢复出厂设置将重置全部配置（保留对话历史），确定？')) return; try { const ok = await window.huangquan.settings.reset(); showToast(ok ? '已恢复出厂设置，请重启应用' : '操作失败'); } catch { showToast('操作失败') } }}>恢复出厂设置</button>
          <button style={S.btn('primary')} onClick={async () => { try { const workDir = g.workDir || ''; const path = await window.huangquan.sessions.export(g.exportFormat || 'md', workDir); showToast(path.startsWith('E:') ? path : ('已导出：' + path)) } catch { showToast('导出失败') } }}>导出对话历史</button>
        </div>
        <div style={S.row}><div style={S.label}>导出格式</div><select style={S.sel} value={g.exportFormat || 'md'} onChange={e => save({ exportFormat: e.target.value })}><option value="md">Markdown</option><option value="json">JSON</option><option value="txt">纯文本</option></select></div>
        <Toggle checked={g.trayEnabled !== false} onChange={v => save({ trayEnabled: v })} label="关闭时缩至系统托盘" hint="默认开启：点击关闭按钮窗口隐藏到托盘继续运行，从托盘菜单「退出」才真正退出；最小化则正常缩到任务栏" />
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
