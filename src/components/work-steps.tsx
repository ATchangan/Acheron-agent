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
