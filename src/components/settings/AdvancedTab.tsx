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
        <div style={S.hint}>应用自动识别本机 GPU:检测到可用 GPU 即自动启用硬件加速;无 GPU 或驱动异常时自动降级 CPU 软件渲染,无需手动指定。切换后需重启应用生效。</div>
        <div style={S.row}><div style={S.label}>渲染模式</div><select style={S.sel} value={g.rendererMode || 'auto'} onChange={e => save({ rendererMode: e.target.value })}>
          <option value="auto">自动识别(推荐,自动探测GPU)</option><option value="gpu">强制 GPU 加速</option><option value="cpu">CPU 软件渲染(兼容)</option>
        </select></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button style={S.btn('ghost')} onClick={async () => { try { const st = await window.huangquan?.web.rendererStatus(); if (st) alert('渲染状态:\n模式: ' + st.mode + '\nGPU 加速: ' + st.gpuAcceleration + '\nWebGL: ' + st.webgl + '\nCanvas2D: ' + st.canvas2d) } catch { /* 忽略 */ } }}>查看当前渲染状态</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>执行控制</div>
        <NumSetting label="工具调用上限" hint="单轮任务最多 LLM 工具调用轮次" value={g.maxToolRounds || 50} min={5} max={200} unit="轮" onChange={v => save({ maxToolRounds: v })} />
        <NumSetting label="失败重试次数" hint="单个工具失败后重试次数（0=不重试）" value={g.retryCount ?? 3} min={0} max={10} unit="次" onChange={v => save({ retryCount: v })} />
        <NumSetting label="工具超时" hint="单工具调用超时阈值" value={g.toolTimeout || 120} min={10} max={600} unit="秒" onChange={v => save({ toolTimeout: v })} />
        <NumSetting label="熔断阈值" hint="同工具+同参数重复调用上限" value={g.meltdownLimit || 3} min={1} max={10} unit="次" onChange={v => save({ meltdownLimit: v })} />
        <Toggle checked={g.parallelTools !== false} onChange={v => save({ parallelTools: v })} label="并行工具执行" hint="读类工具（read/ls/search 等）并发执行，减少等待时间" />
      </div>
      <div style={S.card}>
        <div style={S.section}>上下文管理</div>
        <NumSetting label="压缩触发阈值" hint="Token 用量超过模型上限此比例时触发智能压缩" value={Math.round((g.compactThreshold || 0.7) * 100)} min={30} max={95} unit="%" onChange={v => save({ compactThreshold: v / 100 })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>交互与通知</div>
        <Toggle checked={g.notifyEnabled !== false} onChange={v => save({ notifyEnabled: v })} label="桌面通知" hint="Agent 完成/异常时通过 bridge_notify 推送系统通知" />
        <Toggle checked={g.episodicMemory !== false} onChange={v => save({ episodicMemory: v })} label="情景记忆" hint="自动记录文件操作到审计日志（audit_log 可回溯）" />
        <Toggle checked={g.singleBubble !== false} onChange={v => save({ singleBubble: v })} label="单气泡渲染" hint="整轮任务合并为一条消息（关闭则每步工具调用独立显示气泡）" />
        <NumSetting label="卡片最大高度" hint="show_card 交互卡片的最高像素" value={g.cardMaxHeight || 500} min={100} max={2000} unit="px" onChange={v => save({ cardMaxHeight: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>路径与权限</div>
        <div style={S.label}>工作目录</div>
        <div style={S.hint}>Agent 默认读写文件的根目录</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, position: 'relative' }}>
          <input style={{ ...S.inp, flex: 1 }} value={g.workDir || ''} placeholder="如 D:\桌面\黄泉工作台" onChange={e => save({ workDir: e.target.value })} />
          <span style={{ flexShrink: 0, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex' }} title="选择工作目录" onClick={async () => { const path = await window.huangquan.computer.selectDir(); if (path) save({ workDir: path }) }}><MoreHorizontal size={16} /></span>
        </div>
        <div style={{ marginTop: 14 }}><div style={S.label}>文件操作权限</div><div style={S.hint}>控制 Agent 对文件系统的操作范围</div></div>
        <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.filePermission || 'full'} onChange={e => save({ filePermission: e.target.value })}>
          <option value="full">完整权限 — 读写执行均可</option>
          <option value="ask">操作前询问 — 写/删操作需人工确认</option>
          <option value="readonly">只读 — 仅允许读取，禁止写入/删除/执行</option>
          <option value="sandbox">工作区沙箱 — 仅限工作目录内操作</option>
        </select>
      </div>
      <div style={S.card}>
        <div style={S.section}>RAG 向量库</div>
        <div style={S.hint}>语义记忆存储配置（import_doc / recall_memory 使用）</div>
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + C.border, borderRadius: 8, background: C.input }}>
          <div style={S.label}>嵌入引擎(语义检索)</div>
          <div style={S.hint}>填入 OpenAI 兼容的 /embeddings 服务(如本地 LM Studio 加载 embedding 模型, 或 OpenAI 官方)。留空则使用内置关键词检索。</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <div style={{ flex: 2 }}><div style={S.label}>Base URL</div><input style={S.inp} placeholder="http://127.0.0.1:1234/v1" value={g.embeddingBaseUrl || ''} onChange={e => save({ embeddingBaseUrl: e.target.value })} /></div>
            <div style={{ flex: 1.2 }}><div style={S.label}>模型名</div><input style={S.inp} placeholder="text-embedding-3-small / bge-m3" value={g.embeddingModel || ''} onChange={e => save({ embeddingModel: e.target.value })} /></div>
          </div>
          <div style={{ marginTop: 8 }}><div style={S.label}>API Key（本地服务可留空）</div><input type="password" style={S.inp} placeholder="sk-..." value={g.embeddingApiKey || ''} onChange={e => save({ embeddingApiKey: e.target.value })} /></div>
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
        <div style={S.section}>语音 TTS / ASR</div>
        <Toggle checked={g.ttsEnabled === true} onChange={v => save({ ttsEnabled: v })} label="TTS 语音合成" hint="消息下方 按钮朗读回复（Windows 内置语音引擎, 离线可用）" />
      </div>
      <div style={S.card}>
        <div style={S.section}>日志与调试</div>
        <div style={S.label}>日志级别</div>
        <select style={{ ...S.sel, width: '100%', marginTop: 6 }} value={g.logLevel || 'info'} onChange={e => save({ logLevel: e.target.value })}>
          <option value="debug">Debug — 全部日志（含工具调用详情）</option>
          <option value="info">ℹInfo — 常规信息（默认）</option>
          <option value="warn">Warn — 仅警告和错误</option>
          <option value="error">Error — 仅错误</option>
        </select>
        <Toggle checked={g.devTools !== false} onChange={v => save({ devTools: v })} label="开发者工具" hint="启动时自动打开 Electron DevTools" />
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
        <Toggle checked={g.trayEnabled === true} onChange={v => save({ trayEnabled: v })} label="最小化/关闭时缩至系统托盘" hint="开启后点击最小化或关闭按钮，窗口隐藏到托盘继续运行；从托盘菜单「退出」才真正退出" />
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
