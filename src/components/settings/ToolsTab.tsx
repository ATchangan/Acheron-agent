import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle, NumSetting } from '../settings-ui'

// v0.3.1 块 H: 工具 tab(从 SettingsView 拆分, 行为零变化)
export default function ToolsTab() {
  const g = useSettingsStore(s => s.general) || {}
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = (patch: Partial<import('../../types').GeneralSettings>) => { useSettingsStore.setState(s2 => ({ general: { ...(s2.general || {}), ...patch } })); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => useSettingsStore.getState().save(), 300) }
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }
  const [pluginList, setPluginList] = useState<{ plugin: string; name: string; description: string }[]>([])
  useEffect(() => { window.huangquan.plugins.tools().then((l) => setPluginList(Array.isArray(l) ? l : [])).catch(() => setPluginList([])) }, [])
  const pluginPerm = (g?.pluginPerm) || {}
  const cyclePluginPerm = (key: string) => {
    const cur = pluginPerm[key] || 'ask'
    const next = cur === 'allow' ? 'deny' : cur === 'deny' ? 'ask' : 'allow'
    save({ pluginPerm: { ...pluginPerm, [key]: next } })
  }
  const [showPluginInput, setShowPluginInput] = useState(false)
  const [pluginUrl, setPluginUrl] = useState('')
  return (
    <div style={{ flex: 1, padding: '20px 24px', overflowY: 'auto' }}>
      <div style={S.card}>
        <div style={S.section}>工具总览仪表盘</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          {([
            ['文件', 'filesystem', ['read', 'write', 'edit', 'mkdir', 'ls', 'grep', 'find']],
            ['Shell', 'shell', ['exec_command', 'codebox']],
            ['浏览器', 'browser', ['browse', 'browse_screenshot', 'web_search', 'web_fetch']],
            ['桌面', 'desktop', ['screenshot', 'clipboard_read', 'clipboard_write', 'system_info', 'process_list', 'kill_process', 'read_image']],
            ['办公', 'office', ['import_doc']],
            ['媒体', 'media', ['show_card']],
            ['数据库', 'database', []],
            ['网络', 'network', ['web_search', 'web_fetch']],
            ['MCP', 'mcp', ['mcp_connect', 'mcp_call']],
            ['插件', 'plugins', []],
            ['定时', 'schedule', ['schedule_task', 'list_schedules', 'watch_file', 'list_workflows', 'run_workflow']],
            ['通知', 'notify', ['bridge_notify', 'save_goal', 'list_goals', 'save_memory', 'recall_memory', 'audit_log']],
          ] as [string, string, string[]][]).map(([label, cat, tools]) => {
            const disabled = ((g.disabledTools || []) as string[])
            const enabled = tools.filter(t => !disabled.includes(t))
            const allOn = tools.length > 0 && enabled.length === tools.length
            const anyOn = enabled.length > 0
            return <div key={cat} style={{ padding: 10, borderRadius: 8, border: '1px solid ' + C.border, cursor: 'pointer', background: allOn ? C.accentBg : anyOn ? 'transparent' : 'rgba(255,50,50,0.05)', opacity: tools.length === 0 ? 0.4 : 1 }}
              onClick={() => {
                const d = [...disabled]
                if (allOn && tools.length > 0) tools.forEach(t => { if (!d.includes(t)) d.push(t) })
                else tools.forEach(t => { const i = d.indexOf(t); if (i >= 0) d.splice(i, 1) })
                save({ disabledTools: d })
              }}>
              <div style={{ fontSize: 'calc(var(--ui-font-size) + 5px)', marginBottom: 2, fontWeight: 600, color: C.text }}>{label}</div>
              <div style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: allOn ? C.accent : C.muted }}>{tools.length === 0 ? '(暂未实现)' : allOn ? '● 全部启用' : anyOn ? '◐ 部分启用' : '○ 未启用'}</div>
            </div>
          })}
        </div>
        <div style={{ textAlign: 'right', marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button style={S.btn('danger')} onClick={() => save({ disabledTools: ['read', 'write', 'edit', 'mkdir', 'ls', 'grep', 'find', 'exec_command', 'codebox', 'browse', 'browse_screenshot', 'web_search', 'web_fetch', 'screenshot', 'clipboard_read', 'clipboard_write', 'system_info', 'process_list', 'kill_process', 'read_image', 'import_doc', 'show_card', 'mcp_connect', 'mcp_call', 'schedule_task', 'list_schedules', 'watch_file', 'list_workflows', 'run_workflow', 'bridge_notify', 'save_goal', 'list_goals', 'save_memory', 'recall_memory', 'audit_log'] })}>全部禁用</button>
          <button style={S.btn('ghost')} onClick={() => save({ disabledTools: [] })}>恢复默认</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>插件工具 ({pluginList.length})</div>
        <div style={S.hint}>插件工具运行在 vm 沙箱(文件仅限工作目录、命令受危险拦截)。默认首次调用弹确认, 此处可提前放行/禁用。点击行切换。</div>
        {pluginList.length === 0 ? (
          <div style={S.hint}>暂无已安装插件工具(需插件目录含 index.js 实现)</div>
        ) : pluginList.map(t => {
          const key = t.plugin + ':' + t.name
          const perm = pluginPerm[key] || 'ask'
          return (
            <div key={key} onClick={() => cyclePluginPerm(key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderRadius: 6, border: '1px solid ' + C.border, marginTop: 6, cursor: 'pointer' }}>
              <div>
                <div style={{ fontWeight: 600, color: C.text, fontSize: 'calc(var(--ui-font-size) - 1px)' }}>{t.plugin}/{t.name}</div>
                <div style={{ color: C.muted, fontSize: 'calc(var(--ui-font-size) - 3px)' }}>{(t.description || '').slice(0, 40)}</div>
              </div>
              <span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: perm === 'allow' ? C.green : perm === 'deny' ? C.danger : C.accent, padding: '2px 10px', borderRadius: 10, border: '1px solid ' + (perm === 'allow' ? C.green : perm === 'deny' ? C.danger : C.accent) }}>
                {perm === 'allow' ? '🟢 放行' : perm === 'deny' ? '🔴 禁用' : '🟡 询问'}
              </span>
            </div>
          )
        })}
      </div>
      <div style={S.card}>
        <div style={S.section}>浏览器</div>
        <div style={S.hint}>实时浏览面板(可视化查看 agent 浏览)、主窗口内使用提示、网页解析工具(Playwright 无头内核)。三类配置互不影响、真实生效。</div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: 'var(--accent-purple)', margin: '10px 0 4px' }}>▍实时浏览面板</div>
        <div style={S.row}><div style={S.label}>默认主页</div><input style={S.inp} placeholder="https://example.com" value={g.browserHomeUrl || ''} onChange={e => save({ browserHomeUrl: e.target.value })} /><div style={S.hint}>打开浏览器窗口时自动加载的页面</div></div>
        <div style={S.row}><div style={S.label}>窗口宽度</div><input type="number" style={S.inp} value={g.browserWinW ?? 1280} onChange={e => save({ browserWinW: parseInt(e.target.value) || 1280 })} /><div style={S.hint}>px,不小于 600</div></div>
        <div style={S.row}><div style={S.label}>窗口高度</div><input type="number" style={S.inp} value={g.browserWinH ?? 860} onChange={e => save({ browserWinH: parseInt(e.target.value) || 860 })} /><div style={S.hint}>px,不小于 400</div></div>
        <div style={S.row}><div style={S.label}>画面刷新间隔</div><input type="number" style={S.inp} value={g.browserSnapMs ?? 1200} onChange={e => save({ browserSnapMs: parseInt(e.target.value) || 1200 })} /><div style={S.hint}>ms,实时画面截图刷新频率,越小越流畅但更耗资源</div></div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: 'var(--accent-purple)', margin: '10px 0 4px' }}>▍使用提示(主窗口内横幅)</div>
        <div style={S.row}><div style={S.label}>使用浏览器时提示</div><Toggle checked={g.browserFloatEnabled !== false} onChange={v => save({ browserFloatEnabled: v })} label="agent 使用浏览器时在主窗口内显示提示横幅" /></div>
        <div style={S.row}><div style={S.label}>提示位置</div><select style={S.sel} value={g.browserFloatPos || 'top-right'} onChange={e => save({ browserFloatPos: e.target.value })}>
          <option value="top-right">右上角</option><option value="top-center">顶部居中</option><option value="bottom-left">左下角</option><option value="bottom-right">右下角</option>
        </select><div style={S.hint}>横幅在主窗口内的显示位置(非系统屏幕角)</div></div>
        <div style={S.row}><div style={S.label}>提示停留</div><input type="number" style={S.inp} value={g.browserFloatTimeout ?? 30} onChange={e => save({ browserFloatTimeout: parseInt(e.target.value) || 30 })} /><div style={S.hint}>秒</div></div>
        <div style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 700, color: 'var(--accent-purple)', margin: '10px 0 4px' }}>▍网页解析工具 (web_read)</div>
        <div style={S.hint}>基于 Playwright + Chromium 无头内核,Agent 调用 web_read 时临时启动、用完自动销毁,不长期驻留内存。支持 JS 动态渲染页面、提取标题与清洗后的正文、截图、转 PDF。</div>
        <div style={S.row}><div style={S.label}>启用解析工具</div><Toggle checked={g.webReadEnabled !== false} onChange={v => save({ webReadEnabled: v })} label="总开关,关闭后 Agent 无法调用 web_read" /></div>
        <div style={S.row}><div style={S.label}>强制无头模式</div><Toggle checked={g.webReadHeadless !== false} onChange={v => save({ webReadHeadless: v })} label="取消勾选则可视化弹出浏览器窗口(用于调试页面)" /></div>
        <div style={S.row}><div style={S.label}>页面加载超时</div><input type="number" style={S.inp} value={g.webReadTimeout ?? 15000} onChange={e => save({ webReadTimeout: parseInt(e.target.value) || 15000 })} /><div style={S.hint}>ms</div></div>
        <div style={S.row}><div style={S.label}>自定义 User-Agent</div><input style={S.inp} placeholder="留空使用默认 UA" value={g.webReadUA || ''} onChange={e => save({ webReadUA: e.target.value })} /></div>
        <div style={S.row}><div style={S.label}>HTTP 代理地址</div><input style={S.inp} placeholder="http://127.0.0.1:7890 (留空不使用)" value={g.webReadProxy || ''} onChange={e => save({ webReadProxy: e.target.value })} /></div>
        <div style={S.row}><div style={S.label}>Cookie(登录态)</div><input style={S.inp} placeholder='如: session=abc123; token=xyz 或 [{"name":"session","value":"abc123","domain":".example.com"}]' value={g.webReadCookies || ''} onChange={e => save({ webReadCookies: e.target.value })} /></div>
        <div style={S.hint}>用于读取需要登录/带会话的网页,支持 "k=v; k2=v2" 字符串或 JSON 数组格式;留空则不注入</div>
        <div style={S.row}><div style={S.label}>任务完成自动关闭</div><Toggle checked={g.webReadAutoClose !== false} onChange={v => save({ webReadAutoClose: v })} label="任务执行完毕自动销毁浏览器及页面进程" /></div>
        <div style={S.row}><div style={S.label}>自动清洗广告</div><Toggle checked={g.webReadCleanAds !== false} onChange={v => save({ webReadCleanAds: v })} label="读取完成自动剔除广告/导航栏等冗余元素" /></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button style={S.btn('primary')} onClick={() => { try { window.huangquan?.web.showPanel() } catch { /* 忽略 */ } }}>打开浏览器窗口</button>
          <button style={S.btn('primary')} onClick={() => { try { window.huangquan?.web.read('https://example.com', 'text').then((raw: string) => { try { const r = JSON.parse(raw); alert(r.ok ? 'web_read 自检成功\n标题: ' + r.title + '\n正文长度: ' + (r.text || '').length : 'web_read 失败: ' + r.error) } catch { alert('web_read 返回异常: ' + String(raw).slice(0, 200)) } }) } catch { /* 忽略 */ } }}>web_read 自检</button>
          <button style={S.btn('ghost')} onClick={() => { save({ browserHomeUrl: '', browserFloatPos: 'top-right', browserFloatTimeout: 30, browserSnapMs: 1200, webReadEnabled: true, webReadHeadless: true, webReadTimeout: 15000, webReadUA: '', webReadProxy: '', webReadAutoClose: true, webReadCleanAds: true, webReadCookies: '' }) }}>恢复默认</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>可用工具</div>
        <div style={S.hint}>关闭不需要的工具可减少 Token 消耗，加速响应</div>
        {[
          ['read', '读取文件'], ['write', '写入文件'], ['edit', '编辑文件'], ['exec_command', '命令执行'],
          ['mkdir', '创建目录'], ['ls', '列出目录'], ['grep', '文本搜索'], ['find', '文件查找'],
          ['web_search', '网页搜索'], ['web_fetch', '网页抓取'], ['browse', '浏览器'], ['browse_screenshot', '网页截图'],
          ['screenshot', '屏幕截图'], ['clipboard_read', '读取剪贴板'], ['clipboard_write', '写入剪贴板'],
          ['system_info', '系统信息'], ['process_list', '进程列表'], ['kill_process', '结束进程'],
          ['codebox', '代码沙箱'], ['save_memory', '保存记忆'], ['recall_memory', '语义搜索'],
          ['schedule_task', '定时任务'], ['list_schedules', '查看定时'],
          ['mcp_connect', 'MCP连接'], ['mcp_call', 'MCP调用'],
          ['handoff', 'Agent交接'], ['list_agents', '查看Agent'], ['list_workflows', '查看工作流'], ['run_workflow', '执行工作流'],
          ['read_image', '读取图片'], ['set_workdir', '切换目录'], ['set_theme', '切换主题'],
          ['show_card', '交互卡片'], ['bridge_notify', '桌面通知'], ['workflow', '工作流脚本'],
          ['audit_log', '审计日志'], ['watch_file', '文件监控'], ['save_goal', '持久目标'], ['list_goals', '查看目标'],
          ['import_doc', '导入文档'],
        ].map(([name, desc]) => {
          const disabled = (g.disabledTools || []) as string[]
          const on = !disabled.includes(name)
          return <div key={name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
            <div><span style={{ fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: 600, color: on ? C.text : C.muted }}>{name}</span><span style={{ fontSize: 'calc(var(--ui-font-size) - 3px)', color: C.muted, marginLeft: 8 }}>{desc}</span></div>
            <div onClick={() => { const d = [...disabled]; if (on) d.push(name); else d.splice(d.indexOf(name), 1); save({ disabledTools: d }) }} style={{ width: 36, height: 20, borderRadius: 10, background: on ? C.accent : C.border, cursor: 'pointer', position: 'relative', flexShrink: 0 }}><div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 3, left: on ? 19 : 3, transition: 'all .12s' }} /></div>
          </div>
        })}
      </div>
      <div style={S.card}>
        <div style={S.section}>缓存管理</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0' }}>
          <div><div style={{ fontSize: 'calc(var(--ui-font-size) - 1px)', color: C.text }}>工具调用缓存</div><div style={S.hint}>读操作（read/ls/search）结果缓存，写操作自动失效</div></div>
          <button style={S.btn('ghost')} onClick={async () => { try { const stats = await window.huangquan.cacheStats?.(); alert(JSON.stringify(stats, null, 2)) } catch { alert('缓存模块未加载') } }}>查看</button>
        </div>
        <div style={{ textAlign: 'right' }}><button style={S.btn('danger')} onClick={async () => { try { await window.huangquan.cacheClear?.(); alert('缓存已清空') } catch { alert('操作失败') } }}>清空缓存</button></div>
      </div>
      <div style={S.card}>
        <div style={S.section}>会话管理</div>
        <Toggle checked={g.autoSave !== false} onChange={v => save({ autoSave: v })} label="自动保存会话" hint="每次对话结束后自动保存到本地文件" />
        <NumSetting label="最大会话数" hint="超出后自动清理最早的会话" value={g.maxSessions || 50} min={5} max={200} unit="个" onChange={v => save({ maxSessions: v })} />
      </div>
      <div style={S.card}>
        <div style={S.section}>插件管理</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {!showPluginInput ? (
            <button style={S.btn('primary')} onClick={() => setShowPluginInput(true)}>安装插件</button>
          ) : (
            <div style={{ display: 'flex', gap: 6, flex: 1 }}>
              <input style={{ ...S.inp, flex: 1 }} placeholder="Git URL..." value={pluginUrl} onChange={e => setPluginUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && pluginUrl) { window.huangquan.plugins.install(pluginUrl).then(r => { showToast(r); setPluginUrl(''); setShowPluginInput(false) }).catch(() => showToast('安装失败')) } }} autoFocus />
              <button style={S.btn('primary')} onClick={() => { if (pluginUrl) { window.huangquan.plugins.install(pluginUrl).then(r => { showToast(r); setPluginUrl(''); setShowPluginInput(false) }).catch(() => showToast('安装失败')) } }}>确认</button>
              <button style={S.btn('ghost')} onClick={() => { setShowPluginInput(false); setPluginUrl('') }}>取消</button>
            </div>
          )}
          <button style={S.btn('ghost')} onClick={async () => { try { const plugins = await window.huangquan.plugins.scan(); showToast(plugins.length ? plugins.map((p: { name: string; version: string }) => p.name + ' v' + p.version).join(', ') : '暂无已安装插件') } catch { showToast('插件模块未加载') } }}>扫描已安装</button>
        </div>
      </div>
      <div style={S.card}>
        <div style={S.section}>系统信息</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {[
            ['版本', 'v0.3.1'], ['Electron', '32.x'], ['React', '18.3'], ['Zustand', '4.5'],
            ['构建', new Date().toLocaleDateString('zh-CN')], ['工具数', '27'],
            ['Agent数', '7'], ['技能数', '4+']
          ].map(([k, v]) => <div key={k} style={{ minWidth: 100 }}><div style={S.hint}>{k}</div><div style={{ fontSize: 'var(--ui-font-size)', fontWeight: 600, color: C.text }}>{v}</div></div>)}
        </div>
      </div>
      {toast && <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: C.accent, color: '#fff', padding: '10px 18px', borderRadius: 8, fontSize: 'calc(var(--ui-font-size) - 1px)', zIndex: 9999 }}>{toast}</div>}
    </div>
  )
}
