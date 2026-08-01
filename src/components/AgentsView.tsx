import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSettingsStore } from '../store/settings'
import { THEME_COLORS, DEFAULT_THEME } from '../lib/theme'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AgentRoleType = '姬子' | '三月七' | '银狼' | '艾丝妲' | '知更鸟' | '黑天鹅' | '螺丝咕姆'
type AgentStatus = 'idle' | 'working' | 'waiting' | 'inactive'
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

interface Agent {
  id: string
  name: string
  role: AgentRoleType
  icon: string
  status: AgentStatus
  description: string
  taskCount: number
  createdAt: number
}

interface Task {
  id: string
  title: string
  description: string
  agentId: string
  agentName: string
  status: TaskStatus
  createdAt: number
}

interface DiscussionMessage {
  id: string
  agentId: string
  agentName: string
  agentIcon: string
  content: string
  timestamp: number
}

// ---------------------------------------------------------------------------
// Role templates
// ---------------------------------------------------------------------------

interface RoleTemplate {
  role: AgentRoleType
  icon: string
  description: string
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  { role: '姬子', icon: '🕶️', description: '星穹列车领航者，统筹全局任务分配与决策' },
  { role: '三月七',   icon: '📚', description: '智库守护者，擅长文档处理、文本分析、内容审核' },
  { role: '艾丝妲', icon: '📡', description: '空间站站长，负责消息通知、定时提醒、事件监控' },
  { role: '知更鸟', icon: '🕊️', description: '匹诺康尼歌者，专精情感陪伴、心理疏导、日常闲聊' },
  { role: '银狼',   icon: '🐺', description: '王牌骇客，负责安全检查、代码审查、风险预警' },
]

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: '空闲',
  working: '工作中',
  waiting: '等待中',
  inactive: '未激活',
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#4CAF50',
  working: '#FF9800',
  waiting: '#2196F3',
  inactive: '#666666',
}

const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: '待处理',
  in_progress: '进行中',
  completed: '已完成',
  failed: '失败',
}

const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
  pending: '#2196F3',
  in_progress: '#FF9800',
  completed: '#4CAF50',
  failed: '#F44336',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _idCounter = 0
function uid(): string {
  _idCounter++
  return `${Date.now()}-${_idCounter}-${Math.random().toString(36).slice(2, 8)}`
}

function now(): number {
  return Date.now()
}

// ---------------------------------------------------------------------------
// Inline style palette
// ---------------------------------------------------------------------------

const P = {
  bg: '#0D0D1A', surface: '#1A1A2E', accent: '#6B4C9A', text: '#E8E8F0',
  secondary: '#9999AA', border: '#2A2A4A', danger: '#F44336', success: '#4CAF50',
  warn: '#FF9800', info: '#2196F3',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const AgentsView: React.FC = () => {
  // ---- state ---------------------------------------------------------------
  const [agents, setAgents] = useState<Agent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [messages, setMessages] = useState<DiscussionMessage[]>([])

  // UI toggles
  const [showCreateAgent, setShowCreateAgent] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)
  const [taskFilterAgentId, setTaskFilterAgentId] = useState<string>('__all__')

  // Forms
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentRole, setNewAgentRole] = useState<AgentRoleType>('姬子')
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDesc, setNewTaskDesc] = useState('')
  const [newTaskAgentId, setNewTaskAgentId] = useState('')

  // Discussion
  const [discussionTopic, setDiscussionTopic] = useState('')
  const [selectedForDiscussion, setSelectedForDiscussion] = useState<Set<string>>(new Set())
  const [discussionInProgress, setDiscussionInProgress] = useState(false)

  const discussionEndRef = useRef<HTMLDivElement>(null)
  const loadedRef = useRef(false)
  const [activeAgent, setActiveAgent] = useState<string>('')

  // 同步 ChatInput 的 Agent 选择器状态
  useEffect(() => {
    const check = () => {
      const a = (window as any).__huangquan_agent || ''
      setActiveAgent(a)
    }
    check()
    const t = setInterval(check, 1000)
    return () => clearInterval(t)
  }, [])

  // ---- persistence ----------------------------------------------------------

  const persistAgents = useCallback(async (list: Agent[]) => {
    try {
      const mem = await window.huangquan.memory.load()
      const otherFacts = mem.facts.filter(f => !f.startsWith('[agent]'))
      const agentFacts = list.map(a => `[agent]${JSON.stringify(a)}`)
      await window.huangquan.memory.save({ ...mem, facts: [...otherFacts, ...agentFacts] })
    } catch { /* noop */ }
  }, [])

  const persistTasks = useCallback(async (list: Task[]) => {
    try {
      const mem = await window.huangquan.memory.load()
      const otherFacts = mem.facts.filter(f => !f.startsWith('[task]'))
      const taskFacts = list.map(t => `[task]${JSON.stringify(t)}`)
      await window.huangquan.memory.save({ ...mem, facts: [...otherFacts, ...taskFacts] })
    } catch { /* noop */ }
  }, [])

  // ---- load on mount --------------------------------------------------------

  const DEFAULT_AGENTS: Agent[] = [
    { id: '__jizi__', name: '姬子', role: '姬子', icon: '🕶️', status: 'idle', description: '星穹列车领航者，统筹全局任务分配与决策', taskCount: 0, createdAt: 0 },
    { id: '__sanyueqi__', name: '三月七', role: '三月七', icon: '📚', status: 'idle', description: '智库守护者，擅长文档处理、文本分析、内容审核', taskCount: 0, createdAt: 0 },
    { id: '__asta__', name: '艾丝妲', role: '艾丝妲', icon: '📡', status: 'idle', description: '空间站站长，负责消息通知、定时提醒、事件监控', taskCount: 0, createdAt: 0 },
    { id: '__robin__', name: '知更鸟', role: '知更鸟', icon: '🕊️', status: 'idle', description: '匹诺康尼歌者，专精情感陪伴、心理疏导、日常闲聊', taskCount: 0, createdAt: 0 },
    { id: '__silverwolf__', name: '银狼', role: '银狼', icon: '🐺', status: 'idle', description: '王牌骇客，负责安全检查、代码审查、风险预警', taskCount: 0, createdAt: 0 },
  ]

  const isDefault = (id: string) => id.startsWith('__')

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true
    ;(async () => {
      try {
        const mem = await window.huangquan.memory.load()
        const loadedAgents: Agent[] = []
        const loadedTasks: Task[] = []
        for (const fact of mem.facts) {
          if (fact.startsWith('[agent]')) {
            try { loadedAgents.push(JSON.parse(fact.slice(7))) } catch { /* skip */ }
          } else if (fact.startsWith('[task]')) {
            try { loadedTasks.push(JSON.parse(fact.slice(6))) } catch { /* skip */ }
          }
        }
        // 如果没有保存的 Agent，使用预设
        const finalAgents = loadedAgents.length > 0 ? loadedAgents : DEFAULT_AGENTS
        setAgents(finalAgents)
        setTasks(loadedTasks)
        if (finalAgents.length > 0) setNewTaskAgentId(finalAgents[0].id)
        // 首次加载时持久化预设 Agent
        if (loadedAgents.length === 0) persistAgents(DEFAULT_AGENTS)
      } catch { /* noop */ }
    })()
  }, [])

  // ---- agent CRUD -----------------------------------------------------------

  const createAgent = useCallback(() => {
    const name = newAgentName.trim()
    if (!name) return
    const tpl = ROLE_TEMPLATES.find(r => r.role === newAgentRole)!
    const agent: Agent = {
      id: uid(),
      name,
      role: newAgentRole,
      icon: tpl.icon,
      status: 'idle',
      description: tpl.description,
      taskCount: 0,
      createdAt: now(),
    }
    const next = [...agents, agent]
    setAgents(next)
    persistAgents(next)
    setNewAgentName('')
    setShowCreateAgent(false)
  }, [newAgentName, newAgentRole, agents, persistAgents])

  const toggleAgentStatus = useCallback((id: string) => {
    const next = agents.map(a => {
      if (a.id !== id) return a
      const newStatus: AgentStatus = a.status === 'inactive' ? 'idle' : 'inactive'
      return { ...a, status: newStatus }
    })
    setAgents(next)
    persistAgents(next)
  }, [agents, persistAgents])

  const deleteAgent = useCallback((id: string) => {
    if (isDefault(id)) return
    const next = agents.filter(a => a.id !== id)
    setAgents(next)
    persistAgents(next)
    // also remove associated tasks
    const nextTasks = tasks.filter(t => t.agentId !== id)
    setTasks(nextTasks)
    persistTasks(nextTasks)
  }, [agents, tasks, persistAgents, persistTasks])

  // ---- task CRUD ------------------------------------------------------------

  const createTask = useCallback(() => {
    const title = newTaskTitle.trim()
    if (!title || !newTaskAgentId) return
    const agent = agents.find(a => a.id === newTaskAgentId)
    if (!agent) return
    const task: Task = {
      id: uid(),
      title,
      description: newTaskDesc.trim(),
      agentId: agent.id,
      agentName: agent.name,
      status: 'pending',
      createdAt: now(),
    }
    const nextTasks = [...tasks, task]
    setTasks(nextTasks)
    persistTasks(nextTasks)
    // bump agent taskCount
    const nextAgents = agents.map(a => a.id === agent.id ? { ...a, taskCount: a.taskCount + 1 } : a)
    setAgents(nextAgents)
    persistAgents(nextAgents)
    setNewTaskTitle('')
    setNewTaskDesc('')
    setShowCreateTask(false)
  }, [newTaskTitle, newTaskDesc, newTaskAgentId, agents, tasks, persistAgents, persistTasks])

  const updateTaskStatus = useCallback((taskId: string, status: TaskStatus) => {
    const nextTasks = tasks.map(t => t.id === taskId ? { ...t, status } : t)
    setTasks(nextTasks)
    persistTasks(nextTasks)
  }, [tasks, persistTasks])

  const cancelTask = useCallback((taskId: string) => {
    updateTaskStatus(taskId, 'failed')
  }, [updateTaskStatus])

  const deleteTask = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId)
    const nextTasks = tasks.filter(t => t.id !== taskId)
    setTasks(nextTasks)
    persistTasks(nextTasks)
    if (task) {
      const nextAgents = agents.map(a => a.id === task.agentId ? { ...a, taskCount: Math.max(0, a.taskCount - 1) } : a)
      setAgents(nextAgents)
      persistAgents(nextAgents)
    }
  }, [tasks, agents, persistTasks, persistAgents])

  // ---- discussion ----------------------------------------------------------

  const toggleDiscussionAgent = useCallback((id: string) => {
    setSelectedForDiscussion(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const startDiscussion = useCallback(() => {
    if (selectedForDiscussion.size === 0 || !discussionTopic.trim()) return
    setDiscussionInProgress(true)
    const selectedAgents = agents.filter(a => selectedForDiscussion.has(a.id))

    // Simulate a round of responses
    const topic = discussionTopic.trim()
    const intro: DiscussionMessage = {
      id: uid(),
      agentId: '__system__',
      agentName: '系统',
      agentIcon: '🏛️',
      content: `圆桌讨论开始 — 主题：「${topic}」— 参与者：${selectedAgents.map(a => `${a.icon}${a.name}`).join('、')}`,
      timestamp: now(),
    }
    setMessages(prev => [...prev, intro])

    // Each selected agent responds with a brief message based on role
    const responses: Record<AgentRoleType, string[]> = {
      '姬子': [
        `关于「${topic}」，需要从全局着眼。各位各司其职，方能万无一失。`,
        `好。此事交由三月七梳理资料，艾丝妲监察进度，银狼把关安全，知更鸟安抚人心。`,
        `大局已定。诸位依计行事，我在此统筹。`,
      ],
      '三月七': [
        `关于「${topic}」，我已有初步分析。此事务须条分缕析，逐项核查。`,
        `资料层面我已梳理完毕，关键节点有三：其一为流程合规，其二为数据准确，其三为时效保障。`,
        `资料已备，请姬子过目定夺。`,
      ],
      '艾丝妲': [
        `收到～「${topic}」相关动态已纳入监控，有丝毫风吹草动，我即刻来报。`,
        `已设定三个关键时点提醒，确保每个节点都有人跟进。`,
        `报！前方传来新消息，需诸位关注。`,
      ],
      '知更鸟': [
        `🕊️ 关于「${topic}」，我想从情感角度稍作补充——此事关乎人心，不可全以理度之。`,
        `若是涉及人情往来，不妨多一分体谅，少一分苛责。歌声所至，最知人性冷暖。`,
        `诸位议事劳神，不如听我唱一曲歇息片刻？`,
      ],
      '银狼': [
        `且慢！「${topic}」此事须得严加审查。安全漏洞、代码缺陷、风险隐患，我逐一排查。`,
        `发现可疑之处三处，已标记。建议在推进之前先行修复，免生后患。`,
        `审查完毕。总体风险可控，但不可掉以轻心。`,
      ],
    }

    let delay = 1500
    selectedAgents.forEach((agent, idx) => {
      const lines = responses[agent.role] || [`关于「${topic}」，我将尽力而为。`]
      const line = lines[idx % lines.length]
      setTimeout(() => {
        const msg: DiscussionMessage = {
          id: uid(),
          agentId: agent.id,
          agentName: agent.name,
          agentIcon: agent.icon,
          content: line,
          timestamp: now(),
        }
        setMessages(prev => [...prev, msg])
      }, delay)
      delay += 1800
    })

    setTimeout(() => {
      const outro: DiscussionMessage = {
        id: uid(),
        agentId: '__system__',
        agentName: '系统',
        agentIcon: '🏛️',
        content: '本轮讨论结束。诸神之言皆已记录在案，可据此部署行动。',
        timestamp: now(),
      }
      setMessages(prev => [...prev, outro])
      setDiscussionInProgress(false)
      setDiscussionTopic('')
    }, delay + 1200)
  }, [selectedForDiscussion, discussionTopic, agents])

  // ---- auto-scroll discussion -----------------------------------------------

  useEffect(() => {
    discussionEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ---- filtered tasks -------------------------------------------------------

  const filteredTasks = taskFilterAgentId === '__all__'
    ? tasks
    : tasks.filter(t => t.agentId === taskFilterAgentId)

  const activeAgents = agents.filter(a => a.status !== 'inactive')

  // ---- render ===============================================================

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>◉ 多 Agent 协作</h1>
        <span style={s.subtitle}>Multi-Agent Collaboration Space</span>
        <div style={s.headerStats}>
          <span style={s.statBadge}>{agents.length} 神</span>
          <span style={s.statBadge}>{tasks.filter(t => t.status === 'in_progress').length} 进行中</span>
          <span style={s.statBadge}>{tasks.filter(t => t.status === 'completed').length} 已完成</span>
        </div>
      </div>

      {/* Three-column layout */}
      <div style={s.columns}>
        {/* ============================================================ COL 1: Agents */}
        <div style={s.col}>
          <div style={s.colHeader}>
            <span>👥 众神名录</span>
            <button style={s.btnPrimary} onClick={() => setShowCreateAgent(v => !v)}>
              {showCreateAgent ? '✕ 取消' : '+ 召神'}
            </button>
          </div>

          {/* Create Agent Form */}
          {showCreateAgent && (
            <div style={s.formCard}>
              <input
                style={s.input}
                placeholder="神名..."
                value={newAgentName}
                onChange={e => setNewAgentName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createAgent()}
              />
              <select
                style={s.select}
                value={newAgentRole}
                onChange={e => setNewAgentRole(e.target.value as AgentRoleType)}
              >
                {ROLE_TEMPLATES.map(t => (
                  <option key={t.role} value={t.role}>{t.icon} {t.role}</option>
                ))}
              </select>
              <div style={s.rolePreview}>
                {ROLE_TEMPLATES.find(r => r.role === newAgentRole)?.icon}{' '}
                {ROLE_TEMPLATES.find(r => r.role === newAgentRole)?.description}
              </div>
              <button style={s.btnPrimary} onClick={createAgent}>⚡ 创建 Agent</button>
            </div>
          )}

          {/* Agent Cards */}
          <div style={s.scrollList}>
            {agents.length === 0 && (
              <div style={s.emptyHint}>暂无 Agent，点击上方按钮创建。</div>
            )}
            {agents.map(agent => (
              <div
                key={agent.id}
                style={{
                  ...s.agentCard,
                  opacity: agent.status === 'inactive' ? 0.5 : 1,
                }}
              >
                <div style={s.agentCardTop}>
                  <span style={s.agentIcon}>{agent.icon}</span>
                  <div style={s.agentInfo}>
                    <div style={s.agentName}>{agent.name}</div>
                    <div style={s.agentRoleLabel}>{agent.role}</div>
                  </div>
                  <span style={{ ...s.statusDot, backgroundColor: STATUS_COLORS[agent.status] }}>
                    {STATUS_LABELS[agent.status]}
                  </span>
                  {activeAgent === agent.role && <span style={{ marginLeft: 4, fontSize: 9, color: P.accent, fontWeight: 700, background: P.accent + '22', padding: '1px 6px', borderRadius: 4 }}>活跃</span>}
                </div>
                <div style={s.agentDesc}>{agent.description}</div>
                <div style={s.agentCardBottom}>
                  <span style={s.taskCountBadge}>📋 {agent.taskCount} 任务</span>
                  <div style={s.agentActions}>
                    <button
                      style={s.btnSm}
                      onClick={() => toggleAgentStatus(agent.id)}
                    >
                      {agent.status === 'inactive' ? '激活' : '休眠'}
                    </button>
                    <button
                      style={{ ...s.btnSm, color: P.danger }}
                      onClick={() => deleteAgent(agent.id)}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ============================================================ COL 2: Tasks */}
        <div style={s.col}>
          <div style={s.colHeader}>
            <span>📋 任务卷宗</span>
            <button style={s.btnPrimary} onClick={() => setShowCreateTask(v => !v)}>
              {showCreateTask ? '✕ 取消' : '+ 发布任务'}
            </button>
          </div>

          {/* Create Task Form */}
          {showCreateTask && (
            <div style={s.formCard}>
              <select
                style={s.select}
                value={newTaskAgentId}
                onChange={e => setNewTaskAgentId(e.target.value)}
              >
                <option value="">-- 选择执行者 --</option>
                {activeAgents.map(a => (
                  <option key={a.id} value={a.id}>{a.icon} {a.name} ({a.role})</option>
                ))}
              </select>
              <input
                style={s.input}
                placeholder="任务标题..."
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && createTask()}
              />
              <textarea
                style={s.textarea}
                placeholder="任务描述（可选）..."
                value={newTaskDesc}
                onChange={e => setNewTaskDesc(e.target.value)}
                rows={3}
              />
              <button style={s.btnPrimary} onClick={createTask} disabled={!newTaskAgentId}>
                📜 发布任务
              </button>
            </div>
          )}

          {/* Filter */}
          <div style={s.filterRow}>
            <span style={s.filterLabel}>筛选：</span>
            <select
              style={{ ...s.select, flex: 1 }}
              value={taskFilterAgentId}
              onChange={e => setTaskFilterAgentId(e.target.value)}
            >
              <option value="__all__">👥 全部任务</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
            </select>
          </div>

          {/* Task List */}
          <div style={s.scrollList}>
            {filteredTasks.length === 0 && (
              <div style={s.emptyHint}>暂无任务。召入神祇后即可发布任务。</div>
            )}
            {filteredTasks.map(task => {
              const agent = agents.find(a => a.id === task.agentId)
              return (
                <div key={task.id} style={s.taskCard}>
                  <div style={s.taskCardTop}>
                    <span style={{ fontSize: 13, color: P.secondary }}>
                      {agent?.icon || '👤'} {task.agentName}
                    </span>
                    <span style={{
                      ...s.statusDot,
                      backgroundColor: TASK_STATUS_COLORS[task.status],
                      fontSize: 10,
                    }}>
                      {TASK_STATUS_LABELS[task.status]}
                    </span>
                  </div>
                  <div style={s.taskTitle}>{task.title}</div>
                  {task.description && (
                    <div style={s.taskDesc}>{task.description}</div>
                  )}
                  <div style={s.taskActions}>
                    {task.status === 'pending' && (
                      <button style={s.btnSm} onClick={() => updateTaskStatus(task.id, 'in_progress')}>
                        ▶ 开始
                      </button>
                    )}
                    {task.status === 'in_progress' && (
                      <>
                        <button style={{ ...s.btnSm, color: P.success }} onClick={() => updateTaskStatus(task.id, 'completed')}>
                          ✓ 完成
                        </button>
                        <button style={{ ...s.btnSm, color: P.danger }} onClick={() => cancelTask(task.id)}>
                          ✕ 取消
                        </button>
                      </>
                    )}
                    {(task.status === 'completed' || task.status === 'failed') && (
                      <button style={{ ...s.btnSm, color: P.danger }} onClick={() => deleteTask(task.id)}>
                        🗑 删除
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ============================================================ COL 3: Discussion */}
        <div style={s.col}>
          <div style={s.colHeader}>
            <span>🏛️ 圆桌讨论</span>
            <span style={{ fontSize: 11, color: P.secondary }}>
              已选 {selectedForDiscussion.size} 位
            </span>
          </div>

          {/* Agent selection for discussion */}
          <div style={s.discussionSelectArea}>
            <div style={{ fontSize: 12, color: P.secondary, marginBottom: 8 }}>
              选择参与讨论的神祇：
            </div>
            <div style={s.discussionAgentGrid}>
              {activeAgents.map(agent => {
                const sel = selectedForDiscussion.has(agent.id)
                return (
                  <button
                    key={agent.id}
                    style={{
                      ...s.discussionAgentChip,
                      borderColor: sel ? P.accent : P.border,
                      backgroundColor: sel ? `${P.accent}22` : P.surface,
                    }}
                    onClick={() => toggleDiscussionAgent(agent.id)}
                  >
                    {agent.icon} {agent.name}
                  </button>
                )
              })}
              {activeAgents.length === 0 && (
                <span style={{ fontSize: 12, color: P.secondary }}>请先召入神祇</span>
              )}
            </div>
          </div>

          {/* Topic input */}
          <div style={s.discussionInputArea}>
            <input
              style={s.input}
              placeholder="输入讨论主题..."
              value={discussionTopic}
              onChange={e => setDiscussionTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && startDiscussion()}
              disabled={discussionInProgress}
            />
            <button
              style={{
                ...s.btnPrimary,
                opacity: (selectedForDiscussion.size === 0 || !discussionTopic.trim() || discussionInProgress) ? 0.5 : 1,
              }}
              onClick={startDiscussion}
              disabled={selectedForDiscussion.size === 0 || !discussionTopic.trim() || discussionInProgress}
            >
              {discussionInProgress ? '⏳ 讨论中...' : '🏛️ 开始讨论'}
            </button>
          </div>

          {/* Messages */}
          <div style={s.discussionMessages}>
            {messages.length === 0 && (
              <div style={s.emptyHint}>
                选择多位神祇并输入主题，开启一场圆桌讨论。
                <br /><br />
                众神各抒己见，各展所长，集思广益。
              </div>
            )}
            {messages.map(msg => (
              <div
                key={msg.id}
                style={{
                  ...s.discussionMsg,
                  alignItems: msg.agentId === '__system__' ? 'center' : 'flex-start',
                }}
              >
                {msg.agentId === '__system__' ? (
                  <div style={s.systemMsg}>
                    <span style={{ marginRight: 6 }}>{msg.agentIcon}</span>
                    {msg.content}
                  </div>
                ) : (
                  <>
                    <div style={s.msgAvatar}>{msg.agentIcon}</div>
                    <div style={s.msgBody}>
                      <div style={s.msgHeader}>
                        <span style={s.msgAgentName}>{msg.agentName}</span>
                        <span style={s.msgTime}>
                          {new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div style={s.msgContent}>{msg.content}</div>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={discussionEndRef} />
          </div>

          {/* Clear discussion */}
          {messages.length > 0 && (
            <button
              style={{ ...s.btnSm, alignSelf: 'center', marginTop: 8 }}
              onClick={() => setMessages([])}
            >
              🗑 清空讨论记录
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

const s: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: P.bg,
    color: P.text,
    overflow: 'hidden',
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '12px 20px',
    borderBottom: `1px solid ${P.border}`,
    backgroundColor: P.surface,
    flexShrink: 0,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: P.accent,
    margin: 0,
    whiteSpace: 'nowrap' as const,
  },
  subtitle: {
    fontSize: 12,
    color: P.secondary,
    flex: 1,
  },
  headerStats: {
    display: 'flex',
    gap: 8,
  },
  statBadge: {
    fontSize: 11,
    color: P.secondary,
    backgroundColor: `${P.accent}22`,
    padding: '3px 10px',
    borderRadius: 12,
    border: `1px solid ${P.border}`,
  },

  // Columns
  columns: {
    display: 'flex',
    flex: 1,
    gap: 0,
    overflow: 'hidden',
    minHeight: 0,
  },
  col: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    borderRight: `1px solid ${P.border}`,
    minWidth: 280,
    overflow: 'hidden',
  },
  colHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: `1px solid ${P.border}`,
    backgroundColor: P.surface,
    fontSize: 14,
    fontWeight: 600,
    flexShrink: 0,
  },

  // Scrollable list area
  scrollList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },

  // Form card
  formCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 14px',
    borderBottom: `1px solid ${P.border}`,
    backgroundColor: `${P.surface}88`,
    flexShrink: 0,
  },

  // Inputs
  input: {
    backgroundColor: P.bg,
    border: `1px solid ${P.border}`,
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    color: P.text,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  select: {
    backgroundColor: P.bg,
    border: `1px solid ${P.border}`,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 13,
    color: P.text,
    outline: 'none',
  },
  textarea: {
    backgroundColor: P.bg,
    border: `1px solid ${P.border}`,
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    color: P.text,
    outline: 'none',
    resize: 'vertical' as const,
  },

  // Buttons
  btnPrimary: {
    backgroundColor: P.accent,
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    padding: '7px 14px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnSm: {
    backgroundColor: 'transparent',
    border: `1px solid ${P.border}`,
    borderRadius: 4,
    padding: '3px 8px',
    fontSize: 11,
    color: P.secondary,
    cursor: 'pointer',
  },

  // Role preview
  rolePreview: {
    fontSize: 12,
    color: P.secondary,
    padding: '4px 0',
    lineHeight: 1.4,
  },

  // Agent card
  agentCard: {
    backgroundColor: P.surface,
    border: `1px solid ${P.border}`,
    borderRadius: 8,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  agentCardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  agentIcon: {
    fontSize: 28,
  },
  agentInfo: {
    flex: 1,
  },
  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: P.text,
  },
  agentRoleLabel: {
    fontSize: 11,
    color: P.accent,
  },
  agentDesc: {
    fontSize: 11,
    color: P.secondary,
    lineHeight: 1.4,
  },
  agentCardBottom: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
  },
  agentActions: {
    display: 'flex',
    gap: 6,
  },
  taskCountBadge: {
    fontSize: 11,
    color: P.secondary,
  },
  statusDot: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: 10,
    color: '#fff',
    whiteSpace: 'nowrap' as const,
  },

  // Filter row
  filterRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderBottom: `1px solid ${P.border}`,
    flexShrink: 0,
  },
  filterLabel: {
    fontSize: 12,
    color: P.secondary,
    whiteSpace: 'nowrap' as const,
  },

  // Task card
  taskCard: {
    backgroundColor: P.surface,
    border: `1px solid ${P.border}`,
    borderRadius: 8,
    padding: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    flexShrink: 0,
  },
  taskCardTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: P.text,
  },
  taskDesc: {
    fontSize: 11,
    color: P.secondary,
    lineHeight: 1.4,
  },
  taskActions: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
  },

  // Discussion
  discussionSelectArea: {
    padding: '10px 14px',
    borderBottom: `1px solid ${P.border}`,
    flexShrink: 0,
  },
  discussionAgentGrid: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  discussionAgentChip: {
    fontSize: 11,
    padding: '4px 10px',
    borderRadius: 14,
    border: '1px solid',
    cursor: 'pointer',
    color: P.text,
    display: 'flex' as const,
    alignItems: 'center',
    gap: 4,
  },
  discussionInputArea: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    borderBottom: `1px solid ${P.border}`,
    flexShrink: 0,
  },
  discussionMessages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  discussionMsg: {
    display: 'flex',
    gap: 8,
  },
  msgAvatar: {
    fontSize: 24,
    flexShrink: 0,
    width: 36,
    height: 36,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${P.accent}22`,
    borderRadius: '50%',
  },
  msgBody: {
    flex: 1,
    backgroundColor: P.surface,
    borderRadius: 8,
    padding: '8px 12px',
    border: `1px solid ${P.border}`,
  },
  msgHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  msgAgentName: {
    fontSize: 12,
    fontWeight: 600,
    color: P.accent,
  },
  msgTime: {
    fontSize: 10,
    color: P.secondary,
  },
  msgContent: {
    fontSize: 13,
    color: P.text,
    lineHeight: 1.5,
  },
  systemMsg: {
    fontSize: 12,
    color: P.secondary,
    textAlign: 'center' as const,
    width: '100%',
    fontStyle: 'italic',
    padding: '6px 0',
  },

  // Empty states
  emptyHint: {
    fontSize: 13,
    color: P.secondary,
    textAlign: 'center' as const,
    padding: '40px 20px',
    lineHeight: 1.6,
  },
}

export default AgentsView
