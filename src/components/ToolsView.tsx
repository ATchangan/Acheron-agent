import React, { useState, useEffect, useCallback } from 'react'

/* ─── Tool definitions (20 built-in) ─── */
type Category = '文件' | '系统' | '网络' | '定时'
type PermissionLevel = 'full' | 'ask' | 'deny'

interface ToolDef {
  id: string
  name: string
  description: string
  category: Category
  /** Which window.huangquan API to call for a quick test (null = no quick test) */
  testAction: (() => Promise<unknown>) | null
}

const BUILTIN_TOOLS: ToolDef[] = [
  // 文件 — 9
  { id: 'readFile',        name: '读取文件',   description: '读取指定路径的文件内容',                         category: '文件', testAction: null },
  { id: 'writeFile',       name: '写入文件',   description: '将内容写入指定路径',                             category: '文件', testAction: null },
  { id: 'readDir',         name: '列出目录',   description: '列出目录下的所有文件与子目录',                  category: '文件', testAction: null },
  { id: 'grep',            name: '内容搜索',   description: '在目录中按正则匹配文件内容',                    category: '文件', testAction: null },
  { id: 'find',            name: '查找文件',   description: '按 glob 模式递归查找文件',                      category: '文件', testAction: null },
  { id: 'openFile',        name: '打开文件',   description: '用系统默认程序打开文件',                        category: '文件', testAction: null },
  { id: 'selectFile',      name: '选择文件',   description: '弹出系统文件选择对话框',                        category: '文件', testAction: null },
  { id: 'selectDir',       name: '选择目录',   description: '弹出系统目录选择对话框',                        category: '文件', testAction: null },
  { id: 'readImageBase64', name: '图片读取',   description: '以 Base64 编码读取图片文件',                    category: '文件', testAction: null },

  // 系统 — 8
  { id: 'exec',            name: '执行命令',   description: '在当前环境中执行 Shell 命令',                   category: '系统', testAction: null },
  { id: 'systemInfo',      name: '系统信息',   description: '获取 OS / CPU / 内存 / 运行时间等信息',         category: '系统', testAction: () => window.huangquan.computer.systemInfo() },
  { id: 'screenshot',      name: '截图',       description: '截取当前屏幕并返回图像',                       category: '系统', testAction: null },
  { id: 'processList',     name: '进程列表',   description: '枚举当前运行中的进程',                         category: '系统', testAction: () => window.huangquan.computer.processList() },
  { id: 'killProcess',     name: '终止进程',   description: '通过 PID 终止指定进程',                         category: '系统', testAction: null },
  { id: 'clipboardRead',   name: '读取剪贴板', description: '读取系统剪贴板文本内容',                       category: '系统', testAction: () => window.huangquan.computer.clipboardRead() },
  { id: 'clipboardWrite',  name: '写入剪贴板', description: '将文本写入系统剪贴板',                         category: '系统', testAction: null },
  { id: 'codebox',         name: '代码沙盒',   description: '在隔离沙盒中执行代码片段',                     category: '系统', testAction: null },

  // 网络 — 2
  { id: 'web_fetch',       name: '网页抓取',   description: '通过 HTTP GET 抓取网页内容',                   category: '网络', testAction: null },
  { id: 'web_search',      name: '网页搜索',   description: '通过搜索引擎查询信息',                         category: '网络', testAction: null },

  // 定时 — 1
  { id: 'cron_task',       name: '定时任务',   description: '添加 / 列出 / 移除 / 开关 定时任务',          category: '定时', testAction: () => window.huangquan.cron.list() },
]

/* ─── MCP server type ─── */
interface McpServer {
  name: string
  cmd: string
  args: string[]
}

/* ─── Permission store (localStorage-backed) ─── */
const PERM_KEY = 'huangquan_tool_perms'

function loadPerms(): Record<string, PermissionLevel> {
  try {
    const raw = localStorage.getItem(PERM_KEY)
    return raw ? (JSON.parse(raw) as Record<string, PermissionLevel>) : {}
  } catch { return {} }
}
function savePerms(p: Record<string, PermissionLevel>) {
  try { localStorage.setItem(PERM_KEY, JSON.stringify(p)) } catch { /* quota */ }
}

const PERM_LABEL: Record<PermissionLevel, string> = { full: '允许', ask: '询问', deny: '禁止' }
const PERM_COLOR: Record<PermissionLevel, string> = {
  full: 'var(--accent-green)',
  ask:  'var(--accent)',
  deny: '#ff4466',
}

/* ─── Component ─── */
type Tab = 'builtin' | 'mcp' | 'perms'

export default function ToolsView() {
  /* ── tabs ── */
  const [tab, setTab] = useState<Tab>('builtin')

  /* ── MCP state ── */
  const [servers, setServers] = useState<McpServer[]>([])
  const [mcpName, setMcpName] = useState('')
  const [mcpCmd,  setMcpCmd]  = useState('')
  const [mcpArgs, setMcpArgs] = useState('')
  const [mcpStatus, setMcpStatus] = useState('')

  /* ── permissions ── */
  const [perms, setPerms] = useState<Record<string, PermissionLevel>>(loadPerms)

  /* ── stats ── */
  const [recentCalls, setRecentCalls] = useState(0)

  /* ── test feedback ── */
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  /* ── load MCP servers ── */
  const refreshMcp = useCallback(async () => {
    try {
      const list: unknown = await window.huangquan.mcpList()
      if (Array.isArray(list)) setServers(list as McpServer[])
      else setServers([])
    } catch { setServers([]) }
  }, [])

  useEffect(() => { refreshMcp() }, [refreshMcp])

  /* ── connect MCP ── */
  const connectMcp = async () => {
    if (!mcpName.trim() || !mcpCmd.trim()) return
    setMcpStatus('连接中…')
    try {
      await window.huangquan.mcpConnect(
        mcpName.trim(),
        mcpCmd.trim(),
        mcpArgs.split(/\s+/).filter(Boolean),
      )
      setMcpStatus('✓ 已连接')
      setMcpName(''); setMcpCmd(''); setMcpArgs('')
      await refreshMcp()
    } catch (e: any) {
      setMcpStatus(`✗ ${e?.message || String(e)}`)
    }
  }

  /* ── disconnect MCP ── */
  const disconnectMcp = async (name: string) => {
    try {
      // MCP disconnect is not exposed directly; remove from UI only
      // In practice the backend should handle this — here we optimistically
      // remove from the local list (backend state is authoritative on refresh)
      setServers(prev => prev.filter(s => s.name !== name))
    } catch { /* best-effort */ }
  }

  /* ── test a tool ── */
  const testTool = async (tool: ToolDef) => {
    if (!tool.testAction) return
    setTestResult(null)
    try {
      const result = await tool.testAction()
      setRecentCalls(c => c + 1)
      let text = ''
      if (typeof result === 'string') text = result.slice(0, 200)
      else if (result && typeof result === 'object') text = JSON.stringify(result).slice(0, 200)
      else text = String(result ?? '(无输出)').slice(0, 200)
      setTestResult({ id: tool.id, ok: true, text })
    } catch (e: any) {
      setTestResult({ id: tool.id, ok: false, text: e?.message || String(e) })
    }
  }

  /* ── permission toggle ── */
  const cyclePerm = (id: string) => {
    setPerms(prev => {
      const cur = prev[id] || 'full'
      const next: PermissionLevel = cur === 'full' ? 'ask' : cur === 'ask' ? 'deny' : 'full'
      const updated = { ...prev, [id]: next }
      savePerms(updated)
      return updated
    })
  }

  /* ── derived stats ── */
  const totalTools = BUILTIN_TOOLS.length
  const mcpCount = servers.length
  const permDenied = Object.values(perms).filter(v => v === 'deny').length

  /* ── helpers ── */
  const categoryEmoji = (c: Category) => {
    switch (c) {
      case '文件': return '📁'
      case '系统': return '⚙️'
      case '网络': return '🌐'
      case '定时': return '⏰'
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{
        padding: '16px 24px 0',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)', margin: 0 }}>
          ◆ 工具
        </h2>

        {/* Stats bar */}
        <div style={{
          display: 'flex', gap: 18, marginTop: 10, marginBottom: 8,
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          <span>🔹 内置工具 <b style={{ color: 'var(--text-primary)' }}>{totalTools}</b></span>
          <span>🔌 MCP 服务器 <b style={{ color: 'var(--text-primary)' }}>{mcpCount}</b></span>
          <span>📞 最近调用 <b style={{ color: 'var(--text-primary)' }}>{recentCalls}</b></span>
          {permDenied > 0 && (
            <span style={{ color: '#ff4466' }}>🚫 已禁用 {permDenied}</span>
          )}
        </div>

        {/* Tabs */}
        <div className="settings-tabs" style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 4 }}>
          {([
            { id: 'builtin' as Tab, label: '内置工具' },
            { id: 'mcp'     as Tab, label: 'MCP 服务器' },
            { id: 'perms'   as Tab, label: '权限管理' },
          ]).map(t => (
            <button
              key={t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 24px 24px',
        minHeight: 0,
      }}>
        {/* ═══════ BUILT-IN TOOLS ═══════ */}
        {tab === 'builtin' && (
          <div>
            {(['文件', '系统', '网络', '定时'] as Category[]).map(cat => {
              const tools = BUILTIN_TOOLS.filter(t => t.category === cat)
              return (
                <section key={cat} className="settings-section">
                  <h3>{categoryEmoji(cat)} {cat}类工具</h3>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 8,
                  }}>
                    {tools.map(tool => {
                      const perm: PermissionLevel = perms[tool.id] || 'full'
                      return (
                        <div
                          key={tool.id}
                          className="provider-card"
                          style={{
                            flexDirection: 'column',
                            alignItems: 'stretch',
                            gap: 6,
                            opacity: perm === 'deny' ? 0.45 : 1,
                          }}
                        >
                          {/* top row: name + status + perm */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <strong style={{ fontSize: 13 }}>{tool.name}</strong>
                              <span className="provider-type" style={{ marginLeft: 8 }}>{tool.id}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {/* status dot */}
                              <span
                                title={perm === 'deny' ? '已禁用' : perm === 'ask' ? '需询问' : '可用'}
                                style={{
                                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                  background: perm === 'deny' ? '#ff4466' : perm === 'ask' ? 'var(--accent)' : 'var(--accent-green)',
                                  boxShadow: `0 0 6px ${perm === 'deny' ? '#ff4466' : perm === 'ask' ? 'var(--accent)' : 'var(--accent-green)'}`,
                                  flexShrink: 0,
                                }}
                              />
                              {/* quick-test button */}
                              {tool.testAction && perm !== 'deny' && (
                                <button
                                  className="btn-small"
                                  style={{ fontSize: 10, padding: '2px 7px' }}
                                  onClick={() => testTool(tool)}
                                >
                                  测试
                                </button>
                              )}
                            </div>
                          </div>
                          {/* description */}
                          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                            {tool.description}
                          </div>
                          {/* test result inline */}
                          {testResult?.id === tool.id && (
                            <div style={{
                              fontSize: 10,
                              fontFamily: "'JetBrains Mono', monospace",
                              padding: '4px 8px',
                              borderRadius: 'var(--radius-sm)',
                              background: testResult.ok ? 'rgba(72,201,138,.1)' : 'rgba(255,68,102,.1)',
                              color: testResult.ok ? 'var(--accent-green)' : '#ff4466',
                              maxHeight: 80, overflowY: 'auto',
                              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            }}>
                              {testResult.ok ? '✓ ' : '✗ '}{testResult.text}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {/* ═══════ MCP SERVERS ═══════ */}
        {tab === 'mcp' && (
          <div>
            <section className="settings-section">
              <h3>添加 MCP 服务器</h3>
              <div className="provider-form">
                <div className="form-row">
                  <label>服务器名称</label>
                  <input
                    placeholder="例如: filesystem"
                    value={mcpName}
                    onChange={e => setMcpName(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label>命令</label>
                  <input
                    placeholder="例如: npx -y @modelcontextprotocol/server-filesystem"
                    value={mcpCmd}
                    onChange={e => setMcpCmd(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <label>参数 (空格分隔)</label>
                  <input
                    placeholder="例如: /path/to/allowed/dir"
                    value={mcpArgs}
                    onChange={e => setMcpArgs(e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-primary" onClick={connectMcp}>连接</button>
                  <span style={{ fontSize: 11, color: mcpStatus.startsWith('✗') ? '#ff4466' : 'var(--accent-green)' }}>
                    {mcpStatus}
                  </span>
                </div>
              </div>
            </section>

            <section className="settings-section">
              <h3>已连接的服务器 ({servers.length})</h3>
              {servers.length === 0 ? (
                <p className="empty-hint">暂无 MCP 服务器。使用上方表单添加。</p>
              ) : (
                servers.map(s => (
                  <div key={s.name} className="provider-card">
                    <div className="provider-info">
                      <strong>{s.name}</strong>
                      <span className="provider-type" style={{ marginLeft: 8 }}>{s.cmd} {s.args?.join(' ') || ''}</span>
                    </div>
                    <button
                      className="btn-icon btn-danger"
                      onClick={() => disconnectMcp(s.name)}
                    >
                      断开
                    </button>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {/* ═══════ PERMISSIONS ═══════ */}
        {tab === 'perms' && (
          <div>
            <section className="settings-section">
              <h3>模拟三级权限</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                点击工具行切换权限级别：<span style={{ color: 'var(--accent-green)' }}>允许</span> → <span style={{ color: 'var(--accent)' }}>询问</span> → <span style={{ color: '#ff4466' }}>禁止</span>。权限保存至本地存储。
              </p>
              <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                <span>🟢 允许 {Object.values(perms).filter(v => v === 'full').length}</span>
                <span>🟡 询问 {Object.values(perms).filter(v => v === 'ask').length}</span>
                <span>🔴 禁止 {Object.values(perms).filter(v => v === 'deny').length}</span>
              </div>
            </section>

            {(['文件', '系统', '网络', '定时'] as Category[]).map(cat => {
              const tools = BUILTIN_TOOLS.filter(t => t.category === cat)
              return (
                <section key={cat} className="settings-section">
                  <h3>{categoryEmoji(cat)} {cat}类</h3>
                  {tools.map(tool => {
                    const p: PermissionLevel = perms[tool.id] || 'full'
                    return (
                      <div
                        key={tool.id}
                        className="setting-row"
                        onClick={() => cyclePerm(tool.id)}
                        style={{ cursor: 'pointer' }}
                      >
                        <div>
                          <label style={{ fontSize: 13 }}>{tool.name}</label>
                          <span className="provider-type" style={{ marginLeft: 8 }}>{tool.id}</span>
                        </div>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: PERM_COLOR[p],
                          padding: '2px 10px',
                          borderRadius: 'var(--radius-sm)',
                          border: `1px solid ${PERM_COLOR[p]}`,
                          minWidth: 40, textAlign: 'center',
                        }}>
                          {PERM_LABEL[p]}
                        </span>
                      </div>
                    )
                  })}
                </section>
              )
            })}

            <section className="settings-section" style={{ marginTop: 20 }}>
              <button
                className="btn-small"
                onClick={() => {
                  const reset: Record<string, PermissionLevel> = {}
                  BUILTIN_TOOLS.forEach(t => { reset[t.id] = 'full' })
                  setPerms(reset)
                  savePerms(reset)
                }}
              >
                重置全部为「允许」
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
