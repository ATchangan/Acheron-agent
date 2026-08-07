import React, { useState } from 'react'

// 工具中文名映射(未覆盖的工具回退显示原名)
export const TOOL_LABELS: Record<string, string> = {
  read: '读取文件', read_file: '读取文件', write: '写入文件', edit: '编辑文件', append: '追加内容',
  exec_command: '执行命令', grep: '搜索文本', find: '查找文件', ls: '列出目录', mkdir: '新建目录',
  web_search: '搜索网页', web_fetch: '抓取网页', web_read: '读取网页', browser_snapshot: '浏览器快照',
  codebox: '运行代码', summarize: '总结内容', save_memory: '保存记忆', recall_memory: '回忆记忆',
  session_search: '搜索会话', dispatch: '分发子任务', handoff: '交接角色', list_agents: '查看编队',
  import_doc: '导入文档', media_gen: '生成图片', tts: '语音朗读',
}

// 步骤耗时格式化（575ms / 2.7s / 21s）
export const fmtDur = (ms?: number) => {
  if (ms === undefined || ms === null || ms <= 0) return ''
  return ms < 1000 ? Math.round(ms) + 'ms' : ms < 10000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms / 1000) + 's'
}

// 单个工具行 —— 状态(执行中/完成/失败) + 参数摘要 + 耗时 + 可展开结果
export const ToolChip: React.FC<{
  tc: { id?: string; type?: string; function?: { name?: string; arguments?: string } }
  result?: { content: string; timestamp: number }
  executing?: boolean
  run?: { ms: number; error: boolean; result: string }
}> = ({ tc, result, executing, run }) => {
  const [open, setOpen] = useState(false)
  const fn = tc.function || { name: '', arguments: '' }
  const label = fn.name ? (TOOL_LABELS[fn.name] || fn.name) : '工具'
  let args = ''
  try { args = JSON.stringify(JSON.parse(fn.arguments || '{}'), null, 2) } catch { args = fn.arguments || '' }
  const inline = args.replace(/\n/g, ' ').trim()
  const isError = !!result && result.content.startsWith('E:')
  const status = result ? (isError ? 'error' : 'done') : (executing ? 'running' : 'pending')
  return (
    <div className={`tool-chip tool-chip-${status}`}>
      <div className="tool-chip-head" title={open ? '收起' : '点击查看详情'} onClick={() => setOpen(!open)}>
        <span className="tool-chip-status">{status === 'running' ? <span className="chip-spinner" /> : status === 'error' ? '✗' : status === 'done' ? '✓' : '○'}</span>
        <span className="tool-chip-name">{label}</span>
        {inline && <span className="tool-chip-args">{inline.length > 46 ? inline.slice(0, 46) + '…' : inline}</span>}
        {run?.ms != null && <span className="tool-chip-dur">{fmtDur(run.ms)}</span>}
      </div>
      {open && result && (
        <pre className="tool-chip-result" style={{ color: isError ? 'var(--danger)' : 'var(--text-secondary)' }}>{(result.content || '').slice(0, 8000)}{result.content.length > 8000 ? '\n…[内容过长已截断]' : ''}</pre>
      )}
      {open && !result && <div className="tool-chip-result">{executing ? '执行中…' : '等待执行…'}</div>}
    </div>
  )
}
