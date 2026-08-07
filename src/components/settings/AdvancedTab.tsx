import React, { useState } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, NumSetting } from '../settings-ui'
import { MoreHorizontal } from 'lucide-react'

// v0.3.1 块 H: 引擎 tab(从 SettingsView 拆分, 行为零变化)
export default function AdvancedTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
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
        <NumSetting label="工具调用上限" hint="初始上限，任务仍在推进时自动顺延，直到任务完成" value={g.maxToolRounds || 50} min={5} max={200} unit="轮" onChange={v => save({ maxToolRounds: v })} />
        <NumSetting label="失败重试次数" hint="单个工具失败后重试次数（0=不重试）" value={g.retryCount ?? 3} min={0} max={10} unit="次" onChange={v => save({ retryCount: v })} />
        <NumSetting label="工具超时" hint="单工具/子任务无进展判定阈值，不设总时长上限" value={g.toolTimeout || 120} min={10} max={600} unit="秒" onChange={v => save({ toolTimeout: v })} />
        <NumSetting label="熔断阈值" hint="同一操作反复触发到上限时自动停止" value={g.meltdownLimit || 3} min={1} max={10} unit="次" onChange={v => save({ meltdownLimit: v })} />
        <Toggle checked={g.parallelTools !== false} onChange={v => save({ parallelTools: v })} label="并行工具执行" hint="读取类工具（读取/列出/搜索等）并发执行，减少等待时间" />
      </div>
      <div style={S.card}>
        <div style={S.section}>任务可靠性 (v0.3.3)</div>
        <Toggle checked={g.riskConfirm !== false} onChange={v => save({ riskConfirm: v })} label="风险操作确认" hint="执行命令/删除文件等 L2-L3 操作前弹原生确认框；关闭后静默放行" />
        <NumSetting label="单任务 token 预算" hint="0=不限；任务累计输入/输出/缓存写入 token 达到上限后提前结束，防止失控花费" value={g.maxTaskTokens || 0} min={0} max={1000000} unit="token" onChange={v => save({ maxTaskTokens: v })} />
        <Toggle checked={g.traceEnabled !== false} onChange={v => save({ traceEnabled: v })} label="本地诊断轨迹" hint="记录任务/LLM/工具调用链，可在 设置→诊断 查看；仅存本地" />
        <Toggle checked={g.mcpAutoInject !== false} onChange={v => save({ mcpAutoInject: v })} label="MCP 工具自动注入" hint="连接过的 MCP 服务器工具 schema 自动并入模型工具列表，无需手动 mcp_call" />
        <Toggle checked={g.planGate === true} onChange={v => save({ planGate: v })} label="计划确认门（实验）" hint="首次调用工具前先展示执行计划，等你批准后再动手" />
        <Toggle checked={g.llmSummary === true} onChange={v => save({ llmSummary: v })} label="LLM 摘要压缩（实验）" hint="长会话早期消息交给模型压缩成要点，替代规则截断（消耗少量 token）" />
        <Toggle checked={g.microCompact !== false} onChange={v => save({ microCompact: v })} label="微压缩（每轮小步）" hint="默认开启：每轮结束后把最旧一组问答折进运行摘要，分摊压缩成本，避免一次性大压缩停顿；关闭后回到一次性压缩" />
      </div>
      <div style={S.card}>
        <div style={S.section}>上下文管理</div>
        {/* v0.3.4 T2: 缓存友好度提示 —— system 头部保持稳定即可最大化供应商前缀缓存命中 */}
        <div style={S.hint}>保持系统提示词稳定可降低每次请求费用；切换角色后首次请求费用略高属正常。</div>
        <NumSetting label="压缩触发阈值" hint="对话变长时自动精简较早的内容" value={Math.round((g.compactThreshold || 0.7) * 100)} min={30} max={95} unit="%" onChange={v => save({ compactThreshold: v / 100 })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>缓存管理 (v0.3.3)</div>
        <Toggle checked={g.autoCleanCache !== false} onChange={v => save({ autoCleanCache: v })} label="自动清理 Chromium 缓存" hint="启动时若 Cache/Code Cache/GPU 缓存超过阈值则自动清空（默认开启）" />
        <NumSetting label="清理阈值" hint="缓存总大小超过该值(MB)时自动清理" value={g.autoCleanCacheSize || 200} min={50} max={5000} unit=" MB" onChange={v => save({ autoCleanCacheSize: v })} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <button style={S.btn('ghost')} onClick={async () => {
            try {
              const r = await window.huangquan.cacheCleanChromium()
              showToast('已清理 ' + r.freedMb + 'MB（缓存共 ' + r.totalMb + 'MB）')
            } catch (e) { /* 忽略 */ console.debug('[swallow]', e) }
          }}>立即清理</button>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)' }}>清理后可释放磁盘空间，应用会自动重建缓存</span>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>流量与性能</div>
        <div style={S.hint}>以下优化默认开启，可单独关闭；关闭后相关功能回到旧行为。</div>
        <div style={S.hint}>当前开启 {11 - Object.values(g.perf || {}).filter(v => v === false).length}/11 项</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 14px', alignItems: 'start' }}>
          <Toggle checked={g.perf?.toolWhitelist !== false} onChange={v => save({ perf: { ...(g.perf || {}), toolWhitelist: v } })} label="按任务精简工具" hint="不同任务只展示用得到的工具" />
          <Toggle checked={g.perf?.resultSlim !== false} onChange={v => save({ perf: { ...(g.perf || {}), resultSlim: v } })} label="长内容精简" hint="过长结果只保留开头结尾和关键信息" />
          <Toggle checked={g.perf?.memoryTrim !== false} onChange={v => save({ perf: { ...(g.perf || {}), memoryTrim: v } })} label="记忆按需取用" hint="只取与当前话题相关的记忆" />
          <Toggle checked={g.perf?.workflowLazy !== false} onChange={v => save({ perf: { ...(g.perf || {}), workflowLazy: v } })} label="工作流按需显示" hint="提到工作流时才显示完整模板" />
          <Toggle checked={g.perf?.roundFold !== false} onChange={v => save({ perf: { ...(g.perf || {}), roundFold: v } })} label="旧步骤自动折叠" hint="较早的工具步骤合并成摘要" />
          <Toggle checked={g.perf?.outputCap !== false} onChange={v => save({ perf: { ...(g.perf || {}), outputCap: v } })} label="简短回复限长" hint="简单闲聊限制回答长度" />
          <Toggle checked={g.perf?.imgDowngrade !== false} onChange={v => save({ perf: { ...(g.perf || {}), imgDowngrade: v } })} label="旧图片不重复发送" hint="历史图片只发一次，需要时再取" />
          <Toggle checked={g.perf?.argSlim !== false} onChange={v => save({ perf: { ...(g.perf || {}), argSlim: v } })} label="长参数精简" hint="过长的工具参数只保留关键部分" />
          <Toggle checked={g.perf?.taskArchive !== false} onChange={v => save({ perf: { ...(g.perf || {}), taskArchive: v } })} label="任务记录自动归档" hint="完成任务自动归档，跨任务引用不丢" />
          <Toggle checked={g.perf?.parallelCap !== false} onChange={v => save({ perf: { ...(g.perf || {}), parallelCap: v } })} label="并行结果精简" hint="同时返回过多结果时自动精简" />
          <Toggle checked={g.perf?.interjectMerge !== false} onChange={v => save({ perf: { ...(g.perf || {}), interjectMerge: v } })} label="连续插话合并" hint="连续补充的指令合并成一条" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button style={S.btn('ghost')} onClick={() => { save({ perf: {} }); showToast('已恢复全部默认（全开）') }}>恢复默认</button>
          <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', color: 'var(--text-muted)' }}>改动即时生效并自动保存</span>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>交互与通知</div>
        <Toggle checked={g.notifyEnabled !== false} onChange={v => save({ notifyEnabled: v })} label="桌面通知" hint="任务完成或出错时弹出系统通知" />
        <Toggle checked={g.episodicMemory !== false} onChange={v => save({ episodicMemory: v })} label="操作记录" hint="自动记录文件操作，可随时查看历史" />
        <Toggle checked={g.singleBubble !== false} onChange={v => save({ singleBubble: v })} label="合并为一条回复" hint="整轮任务合并为一条消息；关闭后每一步单独显示" />
        <NumSetting label="卡片最大高度" hint="卡片类内容的最大高度" value={g.cardMaxHeight || 500} min={100} max={2000} unit="px" onChange={v => save({ cardMaxHeight: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>路径与权限</div>
        <div style={S.label}>工作目录</div>
        <div style={S.hint}>默认读写文件的根目录</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, position: 'relative' }}>
          <input style={{ ...S.inp, flex: 1 }} value={g.workDir || ''} placeholder="如 D:\桌面\黄泉工作台" onChange={e => save({ workDir: e.target.value })} />
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
        <div style={S.section}>语义检索向量库</div>
        <div style={S.hint}>语义记忆存储配置（导入文档、回忆记忆时使用）</div>
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + C.border, borderRadius: 8, background: C.input }}>
          <div style={S.label}>向量嵌入引擎（语义检索）</div>
          <div style={S.hint}>填入兼容 OpenAI 的向量接口（例如本地服务加载向量模型，或官方接口）。留空则使用内置关键词检索。</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <div style={{ flex: 2 }}><div style={S.label}>接口地址（Base URL）</div><input style={S.inp} placeholder="http://127.0.0.1:1234/v1" value={g.embeddingBaseUrl || ''} onChange={e => save({ embeddingBaseUrl: e.target.value })} /></div>
            <div style={{ flex: 1.2 }}><div style={S.label}>模型名</div><input style={S.inp} placeholder="text-embedding-3-small / bge-m3" value={g.embeddingModel || ''} onChange={e => save({ embeddingModel: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 8 }}><div style={S.label}>密钥（API Key，本地服务可留空）</div><input type="password" style={S.inp} placeholder="sk-..." value={g.embeddingApiKey || ''} onChange={e => save({ embeddingApiKey: e.target.value })} /></div>
          <div style={S.hint}>保存后, 新写入的语义记忆将自动生成向量, 检索优先使用向量相似度; 未配置或服务不可用时自动回退关键词检索。</div>
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <div style={{ flex: 1 }}><div style={S.label}>分块大小</div><input type="number" style={S.inp} value={g.ragChunkSize || 500} min={100} max={2000} onChange={e => save({ ragChunkSize: parseInt(e.target.value) || 500 })} /></div>
          <div style={{ flex: 1 }}><div style={S.label}>相似度阈值</div><input type="number" style={S.inp} value={Math.round((g.ragThreshold || 0.3) * 100)} min={5} max={95} onChange={e => save({ ragThreshold: (parseInt(e.target.value) || 30) / 100 })} /></div>
        </div>
        <Toggle checked={g.ragAutoSave !== false} onChange={v => save({ ragAutoSave: v })} label="自动保存向量库" hint="每次导入文档后自动持久化到磁盘" />
        <div style={{ textAlign: 'right', marginTop: 8 }}>
          <button style={S.btn('danger')} onClick={async () => { try { await window.huangquan.memory.clearVector(); alert('向量库已清空') } catch { alert('操作失败') } }}>清空向量库</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>语音合成 / 语音识别</div>
        <Toggle checked={g.ttsEnabled === true} onChange={v => save({ ttsEnabled: v })} label="语音合成（TTS）" hint="消息下方的朗读按钮会读出回复（Windows 内置语音引擎，离线可用）" />
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
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <button style={{ ...S.btn('ghost'), height: 24, fontSize: 'calc(var(--ui-font-size) - 4px)', padding: '0 8px' }} onClick={async () => { try { const s = await window.huangquan.storageStats(); const patch: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; const cs = await window.huangquan.cacheStats(); patch['stat_cacheHits'] = cs?.hits || 0; patch['stat_cacheMisses'] = cs?.misses || 0; patch['stat_cacheRate'] = cs?.hit_rate || '0%'; save(patch); showToast('已刷新') } catch { showToast('统计失败') } }}>刷新</button>
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
          <button style={S.btn('ghost')} onClick={async () => { try { await window.huangquan.cacheClear(); showToast('缓存已清除'); const s = await window.huangquan.storageStats(); const patch: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s)) patch['stat_' + k] = v; save(patch) } catch { showToast('清除失败') } }}>清除缓存</button>
          <button style={S.btn('danger')} onClick={async () => { if (!confirm('确定清空全部对话历史？此操作不可恢复')) return; try { await window.huangquan.sessions.clearAll(); showToast('对话历史已清空'); window.location.reload() } catch { showToast('操作失败') } }}>清除对话历史</button>
          <button style={S.btn('danger')} onClick={async () => { if (!confirm('恢复出厂设置将重置全部配置（保留对话历史），确定？')) return; try { const ok = await window.huangquan.settings.reset(); showToast(ok ? '已恢复出厂设置，请重启应用' : '操作失败'); } catch { showToast('操作失败') } }}>恢复出厂设置</button>
          <button style={S.btn('primary')} onClick={async () => { try { const workDir = g.workDir || ''; const path = await window.huangquan.sessions.export(g.exportFormat || 'md', workDir); showToast(path.startsWith('E:') ? path : ('已导出：' + path)) } catch { showToast('导出失败') } }}>导出对话历史</button>
        </div>
        <div style={S.row}><div style={S.label}>导出格式</div><select style={S.sel} value={g.exportFormat || 'md'} onChange={e => save({ exportFormat: e.target.value })}><option value="md">Markdown</option><option value="json">JSON</option><option value="txt">纯文本</option></select></div>
        <Toggle checked={g.trayEnabled !== false} onChange={v => save({ trayEnabled: v })} label="最小化/关闭时缩至系统托盘" hint="默认开启：点击最小化或关闭按钮，窗口隐藏到托盘继续运行；从托盘菜单「退出」才真正退出" />
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
