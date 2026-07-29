import React, { useState, useEffect } from 'react'
import { useSettingsStore } from '../store/settings'
import { v4 as uuidv4 } from 'uuid'

const DEFAULT_MODELS: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
  custom: [],
}

type SettingsTab = 'general' | 'providers' | 'tools' | 'memory' | 'skills' | 'workspace'

const ALL_TOOLS = [
  { id: 'exec_command', name: '执行命令', desc: '运行系统命令 (PowerShell)' },
  { id: 'read', name: '读取文件', desc: '读取本地文件内容' },
  { id: 'write', name: '写入文件', desc: '创建/覆写文件' },
  { id: 'edit', name: '编辑文件', desc: '精确文本替换编辑' },
  { id: 'grep', name: '搜索内容', desc: '在文件中搜索文本' },
  { id: 'find', name: '查找文件', desc: '按模式匹配文件' },
  { id: 'ls', name: '列出目录', desc: '浏览文件夹内容' },
  { id: 'web_search', name: '网页搜索', desc: '搜索互联网' },
  { id: 'web_fetch', name: '网页抓取', desc: '获取网页内容' },
  { id: 'screenshot', name: '截图', desc: '截取屏幕画面' },
  { id: 'memory', name: '记忆', desc: '跨会话保存和回忆' },
]

export default function SettingsView() {
  const providers = useSettingsStore(s => s.providers)
  const addProvider = useSettingsStore(s => s.addProvider)
  const removeProvider = useSettingsStore(s => s.removeProvider)
  const general = useSettingsStore(s => s.general)
  const setTheme = useSettingsStore(s => s.setTheme)

  const [tab, setTab] = useState<SettingsTab>('general')

  // Provider form
  const [showNew, setShowNew] = useState(false)
  const [pType, setPType] = useState('deepseek')
  const [pKey, setPKey] = useState('')
  const [pUrl, setPUrl] = useState('https://api.deepseek.com')
  const [pModels, setPModels] = useState<string[]>(DEFAULT_MODELS.deepseek)
  const [pModel, setPModel] = useState('deepseek-chat')
  const [detecting, setDetecting] = useState(false)

  // Tools toggle
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set())

  // Memory
  const [memFacts, setMemFacts] = useState<string[]>([])
  const [memNew, setMemNew] = useState('')

  // Skills
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])

  // Workspace
  const [wsDir, setWsDir] = useState('')
  const [sysInfo, setSysInfo] = useState<any>(null)

  // Auto start
  const [autoStart, setAutoStart] = useState(false)
  const [startMinimized, setStartMinimized] = useState(false)

  useEffect(() => {
    if (tab === 'memory') window.huangquan.memory.load().then(m => setMemFacts(m.facts || []))
    if (tab === 'skills') window.huangquan.skills.list().then(setSkills)
    if (tab === 'workspace') window.huangquan.computer.systemInfo().then(info => { setSysInfo(info); setWsDir(info.workspaceDir) })
  }, [tab])

  const resetForm = () => {
    setPType('deepseek'); setPKey(''); setPUrl('https://api.deepseek.com')
    setPModels(DEFAULT_MODELS.deepseek); setPModel('deepseek-chat')
  }

  const handleDetect = async () => {
    if (!pKey) return
    setDetecting(true)
    try {
      const list = await window.huangquan.models.detect(pUrl, pKey)
      if (list.length > 0) { setPModels(list); setPModel(list[0]) }
    } catch { /* ok */ }
    setDetecting(false)
  }

  const handleSaveProvider = () => {
    if (!pKey || !pModel) return
    addProvider({
      id: uuidv4(),
      name: pType === 'deepseek' ? 'DeepSeek' : pType === 'openai' ? 'OpenAI' : 'Custom',
      type: pType, apiKey: pKey, baseUrl: pUrl,
      models: pModels.length > 0 ? pModels : [pModel],
      selectedModel: pModel,
    })
    resetForm(); setShowNew(false)
  }

  const handleSaveMemory = async () => {
    if (!memNew.trim()) return
    const m = await window.huangquan.memory.load()
    m.facts.push(memNew.trim())
    await window.huangquan.memory.save(m)
    setMemFacts(m.facts)
    setMemNew('')
  }

  const handleClearMemory = async () => {
    await window.huangquan.memory.save({ facts: [], summaries: [] })
    setMemFacts([])
  }

  const formatBytes = (b: number) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'

  return (
    <div className="settings-view">
      <h2>设置</h2>

      {/* Tab 栏 */}
      <div className="settings-tabs">
        {([
          ['general', '🎛️ 通用'],
          ['providers', '🔑 模型'],
          ['tools', '🔧 工具'],
          ['memory', '🧠 记忆'],
          ['skills', '📋 技能'],
          ['workspace', '💻 工作台'],
        ] as [SettingsTab, string][]).map(([k, v]) => (
          <button key={k} className={`tab-btn ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{v}</button>
        ))}
      </div>

      <div className="settings-content">
        {/* 通用 */}
        {tab === 'general' && (
          <section className="settings-section">
            <h3>通用设置</h3>
            <div className="setting-row">
              <label>主题</label>
              <select value={general.theme} onChange={e => setTheme(e.target.value)}>
                <option value="dark">暗色科技</option>
              </select>
            </div>
            <div className="setting-row" onClick={() => setAutoStart(!autoStart)}>
              <label>开机自启</label>
              <span className={`toggle ${autoStart ? 'on' : ''}`} />
            </div>
            <div className="setting-row" onClick={() => setStartMinimized(!startMinimized)}>
              <label>启动时最小化到托盘</label>
              <span className={`toggle ${startMinimized ? 'on' : ''}`} />
            </div>
            <div className="setting-row">
              <label>最小化到托盘 (关闭窗口时隐藏)</label>
              <span className="toggle on" />
            </div>
          </section>
        )}

        {/* 模型/Providers */}
        {tab === 'providers' && (
          <section className="settings-section">
            <h3>API Provider</h3>
            {providers.map(p => (
              <div key={p.id} className="provider-card">
                <div className="provider-info">
                  <strong>{p.name}</strong>
                  <span className="provider-type">{p.type} · {p.selectedModel || p.models[0]}</span>
                </div>
                <div className="provider-actions">
                  <button className="btn-icon btn-danger" onClick={() => removeProvider(p.id)}>删除</button>
                </div>
              </div>
            ))}
            {!showNew ? (
              <button className="btn-primary" onClick={() => setShowNew(true)}>+ 添加 Provider</button>
            ) : (
              <div className="provider-form">
                <div className="form-row"><label>类型</label>
                  <select value={pType} onChange={e => {
                    setPType(e.target.value)
                    setPUrl(e.target.value === 'deepseek' ? 'https://api.deepseek.com' : e.target.value === 'openai' ? 'https://api.openai.com' : pUrl)
                    setPModels(DEFAULT_MODELS[e.target.value] || [])
                    setPModel((DEFAULT_MODELS[e.target.value] || [])[0] || '')
                  }}><option value="deepseek">DeepSeek</option><option value="openai">OpenAI</option><option value="custom">自定义</option></select>
                </div>
                <div className="form-row"><label>API Key</label>
                  <input type="password" value={pKey} onChange={e => setPKey(e.target.value)} placeholder="sk-..." /></div>
                <div className="form-row"><label>Base URL</label>
                  <input value={pUrl} onChange={e => setPUrl(e.target.value)} /></div>
                <div className="form-row"><label>模型</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select style={{ flex: 1 }} value={pModel} onChange={e => setPModel(e.target.value)}>
                      {pModels.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="btn-small" onClick={handleDetect} disabled={detecting || !pKey}>{detecting ? '…' : '检测'}</button>
                  </div>
                  {pModels.length > 0 && <span className="form-hint">{pModels.length} 个模型可用</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary" onClick={handleSaveProvider} disabled={!pKey}>保存</button>
                  <button className="btn-small" onClick={() => { setShowNew(false); resetForm() }}>取消</button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* 工具 */}
        {tab === 'tools' && (
          <section className="settings-section">
            <h3>工具开关</h3>
            <p className="form-hint" style={{ marginBottom: 12 }}>关闭不需要的工具可以提高安全性</p>
            {ALL_TOOLS.map(t => (
              <div key={t.id} className="setting-row" onClick={() => {
                const next = new Set(disabledTools)
                next.has(t.id) ? next.delete(t.id) : next.add(t.id)
                setDisabledTools(next)
              }}>
                <div>
                  <label>{t.name}</label>
                  <p className="form-hint">{t.desc}</p>
                </div>
                <span className={`toggle ${!disabledTools.has(t.id) ? 'on' : ''}`} />
              </div>
            ))}
          </section>
        )}

        {/* 记忆 */}
        {tab === 'memory' && (
          <section className="settings-section">
            <h3>长期记忆</h3>
            <p className="form-hint" style={{ marginBottom: 12 }}>保存偏好和重要信息，跨会话持久生效</p>
            <div className="provider-form">
              <input className="dropdown-input" placeholder="添加记忆..."
                value={memNew} onChange={e => setMemNew(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSaveMemory()} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" onClick={handleSaveMemory}>保存</button>
                <button className="btn-small btn-danger" onClick={handleClearMemory}>清空全部</button>
              </div>
            </div>
            {memFacts.length > 0 && (
              <div style={{ marginTop: 12 }}>
                {memFacts.map((f, i) => (
                  <div key={i} className="provider-card" style={{ justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12 }}>{f}</span>
                    <button className="btn-icon btn-danger" onClick={async () => {
                      const m = await window.huangquan.memory.load()
                      m.facts.splice(i, 1)
                      await window.huangquan.memory.save(m)
                      setMemFacts(m.facts)
                    }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* 技能 */}
        {tab === 'skills' && (
          <section className="settings-section">
            <h3>已安装技能</h3>
            <p className="form-hint" style={{ marginBottom: 12 }}>AI 会根据对话内容自动调用匹配的技能</p>
            {skills.map(s => (
              <div key={s.name} className="provider-card">
                <div className="provider-info">
                  <strong>{s.name}</strong>
                  <span className="provider-type">{s.description}</span>
                </div>
                <span className="toggle on" />
              </div>
            ))}
            {skills.length === 0 && <p className="empty-hint">无已安装技能。将 SKILL.md 放入 resources/skills/ 目录即可添加。</p>}
          </section>
        )}

        {/* 工作台 */}
        {tab === 'workspace' && (
          <section className="settings-section">
            <h3>工作台</h3>
            {sysInfo && (
              <>
                <div className="setting-row"><label>平台</label><span>{sysInfo.platform} · {sysInfo.arch}</span></div>
                <div className="setting-row"><label>主机名</label><span>{sysInfo.hostname}</span></div>
                <div className="setting-row"><label>CPU</label><span>{sysInfo.cpus} 核心</span></div>
                <div className="setting-row"><label>内存</label><span>{formatBytes(sysInfo.freeMemory)} / {formatBytes(sysInfo.totalMemory)}</span></div>
                <div className="setting-row"><label>运行时间</label><span>{Math.floor(sysInfo.uptime / 3600)}h</span></div>
                <div className="setting-row"><label>工作目录</label><span style={{ fontSize: 11, wordBreak: 'break-all' }}>{wsDir}</span></div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
