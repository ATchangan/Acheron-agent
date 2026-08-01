// electron/workflow/templates.ts — 工作流模板系统
// 灵感来源：Dify Workflow / n8n / LangChain Chains / CrewAI Tasks

export interface WorkflowTemplate {
  id: string; name: string; description: string
  triggers: string[]; steps: WorkflowStep[]
}
export interface WorkflowStep {
  order: number; tool: string; args_template: string
  description: string; verification: string; depends_on: number[]
}

export const BUILTIN_WORKFLOWS: WorkflowTemplate[] = [
  {
    id: 'create-project', name: '创建新项目', description: '从零创建代码项目',
    triggers: ['创建项目', '新建项目', '初始化项目', '搭建项目'],
    steps: [
      { order: 1, tool: 'mkdir', args_template: '{workDir}/{projectName}', description: '创建项目目录', verification: '目录存在', depends_on: [] },
      { order: 2, tool: 'exec_command', args_template: 'cd {workDir}/{projectName} && npm init -y', description: '初始化 package.json', verification: 'package.json 存在', depends_on: [1] },
      { order: 3, tool: 'write', args_template: '{workDir}/{projectName}/README.md', description: '创建 README', verification: '文件存在', depends_on: [1] },
    ],
  },
  {
    id: 'code-review', name: '代码审查', description: '对指定目录/文件进行代码审查',
    triggers: ['审查代码', '代码审查', 'review', 'code review', '检查代码'],
    steps: [
      { order: 1, tool: 'ls', args_template: '{targetPath}', description: '列出文件结构', verification: '非空输出', depends_on: [] },
      { order: 2, tool: 'read', args_template: '{targetPath}/{mainFile}', description: '读取主文件', verification: '非空输出', depends_on: [1] },
      { order: 3, tool: 'grep', args_template: '{targetPath} TODO|FIXME|HACK|BUG', description: '搜索问题标记', verification: '有输出', depends_on: [1] },
    ],
  },
  {
    id: 'web-research', name: '网络调研', description: '搜索并整理某个主题的信息',
    triggers: ['调研', '研究', '查一下', '了解', 'research'],
    steps: [
      { order: 1, tool: 'web_search', args_template: '{query}', description: '搜索主题', verification: '非空输出', depends_on: [] },
      { order: 2, tool: 'web_fetch', args_template: '{firstResultUrl}', description: '抓取首条结果', verification: '非空输出', depends_on: [1] },
      { order: 3, tool: 'save_memory', args_template: '{topic}: {summary}', description: '保存到记忆', verification: '成功', depends_on: [2] },
    ],
  },
  {
    id: 'file-organize', name: '文件整理', description: '整理目录中的文件按类型分类',
    triggers: ['整理文件', '分类文件', '组织文件', 'organize'],
    steps: [
      { order: 1, tool: 'ls', args_template: '{targetPath}', description: '列出所有文件', verification: '非空输出', depends_on: [] },
      { order: 2, tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.md) do move "%f" docs\\', description: '移动文档', verification: '成功', depends_on: [1] },
      { order: 3, tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.jpg *.png) do move "%f" images\\', description: '移动图片', verification: '成功', depends_on: [1] },
    ],
  },
  {
    id: 'deploy-check', name: '部署前检查', description: '项目部署前的环境和配置检查',
    triggers: ['部署检查', '上线检查', '发布检查', 'deploy check', 'pre-flight'],
    steps: [
      { order: 1, tool: 'exec_command', args_template: 'node -v', description: '检查 Node.js 版本', verification: '非空输出', depends_on: [] },
      { order: 2, tool: 'exec_command', args_template: 'npm -v', description: '检查 npm 版本', verification: '非空输出', depends_on: [] },
      { order: 3, tool: 'exec_command', args_template: 'cd {targetPath} && npm ls --depth=0', description: '检查依赖', verification: '非空输出', depends_on: [1, 2] },
      { order: 4, tool: 'read', args_template: '{targetPath}/package.json', description: '检查包配置', verification: '非空输出', depends_on: [1] },
      { order: 5, tool: 'grep', args_template: '{targetPath} console.log|debugger|TODO', description: '检查遗留调试代码', verification: '有输出或空', depends_on: [1] },
    ],
  },
  {
    id: 'daily-summary', name: '每日工作总结', description: '汇总当日工作内容生成日报',
    triggers: ['日报', '每日总结', '工作总结', 'daily summary'],
    steps: [
      { order: 1, tool: 'recall_memory', args_template: '今日工作 重要', description: '回忆今日重要信息', verification: '非空输出', depends_on: [] },
      { order: 2, tool: 'ls', args_template: '{workDir}', description: '查看工作目录', verification: '非空输出', depends_on: [] },
      { order: 3, tool: 'write', args_template: '{workDir}/daily/{date}.md', description: '生成日报文件', verification: '文件存在', depends_on: [1, 2] },
    ],
  },
]

export function matchWorkflow(userMessage: string): WorkflowTemplate | null {
  const txt = userMessage.toLowerCase()
  const matches = BUILTIN_WORKFLOWS
    .map(wf => ({ wf, score: wf.triggers.filter(t => txt.includes(t.toLowerCase())).length }))
    .filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  return matches[0]?.wf || null
}

export function fillTemplate(template: WorkflowTemplate, variables: Record<string, string>): WorkflowStep[] {
  return template.steps.map(step => ({
    ...step,
    args_template: step.args_template.replace(/\{(\w+)\}/g, (_, key) => variables[key] || `{${key}}`),
  }))
}

export function listWorkflowTemplates() {
  return BUILTIN_WORKFLOWS.map(w => ({ id: w.id, name: w.name, description: w.description, triggers: w.triggers.slice(0, 3) }))
}
