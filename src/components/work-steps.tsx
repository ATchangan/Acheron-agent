// 工具中文名映射(未覆盖的工具回退显示原名)
export const TOOL_LABELS: Record<string, string> = {
  read: '读取文件', read_file: '读取文件', write: '写入文件', edit: '编辑文件', append: '追加内容',
  exec_command: '执行命令', grep: '搜索文本', find: '查找文件', ls: '列出目录', mkdir: '新建目录',
  web_search: '搜索网页', web_fetch: '抓取网页', web_read: '读取网页', browser_snapshot: '浏览器快照',
  codebox: '运行代码', summarize: '总结内容', save_memory: '保存记忆', recall_memory: '回忆记忆',
  session_search: '搜索会话', dispatch: '分发子任务', handoff: '交接角色', list_agents: '查看编队',
  import_doc: '导入文档', media_gen: '生成图片',
  desktop_screenshot: '屏幕截图', desktop_click: '点击屏幕', desktop_move: '移动鼠标', desktop_scroll: '屏幕滚动', desktop_type: '输入文本', desktop_key: '发送按键',
  read_skill: '读取技能', skill_manage: '管理技能', update_plan: '更新计划', apply_patch: '应用补丁',
  git: 'Git 操作', init_project_docs: '初始化项目文档',
  terminal_open: '打开终端', terminal_run: '终端命令', terminal_close: '关闭终端',
  browse: '浏览网页', browse_screenshot: '网页截图', browser_click: '点击元素', browser_type: '输入文本',
  browser_press: '模拟按键', browser_scroll: '滚动页面', browser_console: '浏览器控制台', browser_vision: '视觉识别',
  screenshot: '屏幕截图', clipboard_read: '读取剪贴板', clipboard_write: '写入剪贴板',
  process_list: '进程列表', kill_process: '结束进程', system_info: '系统信息',
  recall_events: '回忆事件', recall_tool_output: '回忆工具输出',
  schedule_task: '创建定时任务', list_schedules: '查看定时任务',
  mcp_connect: '连接 MCP', mcp_call: '调用 MCP 工具',
  list_workflows: '查看工作流', run_workflow: '运行工作流', workflow: '工作流',
  read_image: '读取图片', media_img: '生成图片', media_video: '生成视频',
  set_workdir: '设置工作目录', set_theme: '设置主题', set_ui_display: '设置界面', get_ui_display: '查看界面',
  get_settings: '读取设置', set_settings: '修改设置', show_card: '展示卡片', bridge_notify: '发送通知',
  audit_log: '审计日志', watch_file: '监视文件', save_goal: '保存目标', list_goals: '查看目标',
  install_plugin: '安装插件', list_plugins: '插件列表', read_plugin: '读取插件', remove_plugin: '卸载插件', reload_plugins: '重载插件',
  clarify: '澄清提问',
}

// 步骤耗时格式化（575ms / 2.7s / 21s）
export const fmtDur = (ms?: number) => {
  if (ms === undefined || ms === null || ms <= 0) return ''
  return ms < 1000 ? Math.round(ms) + 'ms' : ms < 10000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms / 1000) + 's'
}
