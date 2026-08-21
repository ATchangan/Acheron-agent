// electron/engine/tool-labels.ts — 工具显示标签/参数摘要/预期结果(纯函数, 可单测)
import type { EngineToolCall } from './types'

export function toolLabel(tc: EngineToolCall): string {
  const labels: Record<string, string> = {
    read: '读取文件', write: '写入文件', edit: '编辑文件', exec_command: '执行命令', mkdir: '创建目录',
    apply_patch: '结构化编辑', update_plan: '更新计划', terminal_open: '打开终端', terminal_run: '终端输入', terminal_close: '关闭终端',
    grep: '搜索文件', find: '查找文件', ls: '列出目录', system_info: '获取系统信息', web_search: '网络搜索',
    web_fetch: '抓取网页', web_read: '解析网页', browse: '打开网页', browse_screenshot: '网页截图',
    browser_click: '点击页面元素', browser_type: '输入文字', browser_press: '按键操作', browser_scroll: '滚动页面',
    browser_console: '执行页面脚本', browser_vision: '视觉识别页面', screenshot: '屏幕截图', clipboard_read: '读取剪贴板',
    clipboard_write: '写入剪贴板', process_list: '列出进程', kill_process: '结束进程', save_memory: '保存记忆',
    recall_memory: '检索记忆', session_search: '搜索会话', codebox: '运行代码', import_doc: '导入文档',
    schedule_task: '创建定时任务', list_schedules: '列出定时任务', mcp_connect: '连接 MCP', mcp_call: '调用 MCP 工具',
    handoff: '交接任务', dispatch: '分发子任务', list_agents: '列出角色', list_workflows: '列出工作流',
    run_workflow: '运行工作流', read_image: '读取图片', media_img: '生成图片', media_video: '生成视频',
    set_workdir: '切换工作目录', set_theme: '切换主题', show_card: '渲染卡片', bridge_notify: '桌面通知',
    workflow: '运行工作流脚本', audit_log: '查看审计', watch_file: '监测文件', save_goal: '保存目标',
    list_goals: '查看目标',
  }
  return labels[tc.name] || tc.name
}

export function toolDetail(tc: EngineToolCall): string {
  const args = tc.args || {}
  const keys = Object.keys(args)
  if (!keys.length) return ''
  const pick = ['path', 'query', 'url', 'cmd', 'file', 'dirPath', 'pattern', 'glob', 'tool', 'agent_name', 'workflow_id', 'prompt', 'ref', 'expression', 'pid', 'fact', 'key', 'lang']
  const k = pick.find(x => keys.includes(x)) || keys[0]
  const v = String(args[k]).replace(/\s+/g, ' ').slice(0, 60)
  return v ? k + '=' + v : ''
}

export function toolExpected(tc: EngineToolCall): string {
  const a = tc.args || {}
  switch (tc.name) {
    case 'read': return '读取 ' + String(a.path || '') + ' 的内容'
    case 'ls': return '列出 ' + String(a.dirPath || '工作目录') + ' 下的文件/目录'
    case 'write': return '写入文件 ' + String(a.path || '')
    case 'edit': return '编辑文件 ' + String(a.path || '')
    case 'grep': return '搜索 ' + String(a.pattern || '')
    case 'find': return '查找匹配 ' + String(a.glob || '') + ' 的文件'
    case 'exec_command': return '执行命令并返回输出'
    case 'mkdir': return '创建目录 ' + String(a.path || '')
    case 'web_search': return '搜索: ' + String(a.query || '')
    case 'web_fetch': return '抓取网页: ' + String(a.url || '')
    default: return ''
  }
}
