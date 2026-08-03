// src/store/constants.ts — 纯数据常量(缓存 TTL/工作流模板/视觉模型提示/路由领域词)
// v0.2.4: 从 chat.ts 拆分, 降低单文件复杂度
// v0.3.0 M2: 魔法数字统一(取值=现有代码实际值, 禁止顺手优化)
export const MAX_HISTORY_MSGS = 40        // 历史消息硬上限
export const SUB_ROUND_LIMIT = 8           // dispatch 子任务轮次上限
export const STREAM_THROTTLE_MS = 40       // 流式渲染节流
export const TOOL_ROUND_DEFAULT = 50       // 工具轮次上限默认值(设置项 maxToolRounds 兜底)
export const COMPACT_MSG_DEFAULT = 20      // 压缩阈值默认消息数
export const COMPACT_TOKEN_DEFAULT = 50000 // 压缩阈值默认 token
export const COMPACT_RATIO_DEFAULT = 0.7   // 压缩阈值默认占比

export const CACHE_TTL: Record<string, number> = {
  read: 30000, ls: 30000, grep: 30000, find: 30000,
  web_search: 120000, web_fetch: 120000,
  system_info: 60000, process_list: 60000,
  list_agents: 300000, list_workflows: 300000,
  default: 10000,
}

export const WORKFLOWS: Record<string, { name: string; triggers: string[]; steps: { tool: string; args_template: string; desc: string }[] }> = {
  'create-project': { name: '创建新项目', triggers: ['创建项目','新建项目','初始化项目','搭建项目'], steps: [
    { tool: 'mkdir', args_template: '{workDir}/{projectName}', desc: '创建项目目录' },
    { tool: 'exec_command', args_template: 'cd {workDir}/{projectName} && npm init -y', desc: '初始化 package.json' },
    { tool: 'write', args_template: '{workDir}/{projectName}/README.md', desc: '创建 README' },
  ]},
  'code-review': { name: '代码审查', triggers: ['审查代码','代码审查','review','code review','检查代码'], steps: [
    { tool: 'ls', args_template: '{targetPath}', desc: '列出文件结构' },
    { tool: 'read', args_template: '{mainFile}', desc: '读取主文件' },
    { tool: 'grep', args_template: '{targetPath} TODO|FIXME|HACK|BUG', desc: '搜索问题标记' },
  ]},
  'web-research': { name: '网络调研', triggers: ['调研','研究','查一下','了解','research'], steps: [
    { tool: 'web_search', args_template: '{query}', desc: '搜索主题' },
    { tool: 'web_fetch', args_template: '{firstResultUrl}', desc: '抓取首条结果' },
    { tool: 'save_memory', args_template: '{topic}: {summary}', desc: '保存到记忆' },
  ]},
  'file-organize': { name: '文件整理', triggers: ['整理文件','分类文件','组织文件','organize'], steps: [
    { tool: 'ls', args_template: '{targetPath}', desc: '列出所有文件' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.md) do move "%f" docs\\', desc: '移动文档' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && for %f in (*.jpg *.png) do move "%f" images\\', desc: '移动图片' },
  ]},
  'deploy-check': { name: '部署前检查', triggers: ['部署检查','上线检查','发布检查','deploy check'], steps: [
    { tool: 'exec_command', args_template: 'node -v', desc: '检查 Node.js 版本' },
    { tool: 'exec_command', args_template: 'npm -v', desc: '检查 npm 版本' },
    { tool: 'exec_command', args_template: 'cd {targetPath} && npm ls --depth=0', desc: '检查依赖' },
    { tool: 'read', args_template: '{targetPath}/package.json', desc: '检查包配置' },
    { tool: 'grep', args_template: '{targetPath} console.log|debugger|TODO', desc: '检查遗留调试代码' },
  ]},
}

export const VISION_MODEL_HINTS = ['gpt-4o', 'gpt-4-turbo', 'gpt-4.1', 'claude-3', 'claude-3.5', 'claude-3.7', 'gemini', 'vision', 'vl', 'vlm', 'qwen-vl', 'qwen2-vl', 'glm-4v', 'minimax-vl', 'deepseek-vl', 'internvl', 'llava', 'yi-vision', 'step-1v', 'moonshot-v1-8k-vision', 'agnes-image', 'seedream', 'cogview', 'seedance', 'doubao-seedance', 'wanx', 'kling']

export const DOMAIN_RE: Record<string, RegExp> = {
  '银狼': /安全|漏洞|审查|bug|风险|检查|审计|防护|攻击|渗透|注入|权限|扫描|加密|认证|授权|越权|XSS|SQL注入|CSRF|DDoS|后门|木马|病毒|防火墙|沙箱|隔离|签名|证书|安全策略|加固|修复漏洞|review|security|audit|scan|vuln/,
  '三月七': /文档|报告|总结|分析|整理|翻译|校对|审核|论文|文章|写作|撰写|编辑|排版|格式化|笔记|摘要|纪要|周报|月报|日报|PPT|幻灯片|手册|说明书|合同|协议|白皮书|提案|readme|document|report|translate|summar/,
  '艾丝妲': /提醒|通知|日程|定时|监控|跟踪|闹钟|计划|安排|周期|循环|自动|定时器|cron|日程表|日历|倒计时|推送|alert|remind|schedule|watch|monitor|observe|track/,
  '知更鸟': /聊天|陪伴|心情|安慰|倾诉|放松|故事|累|伤心|难过|开心|快乐|烦|无聊|困|推荐|建议|意见|想法|聊聊|唠嗑|吐槽|八卦|日常|生活|健康|作息|饮食|电影|音乐|游戏|书|小说|娱乐|旅行|天气|新闻|chat|talk|feel|mood|story|tired|sad|happy/,
  '黑天鹅': /设计|画|配色|UI|UX|图标|logo|banner|海报|审美|绘图|可视化|图表|架构图|流程图|时序图|思维导图|脑图|原型|线框|mockup|sketch|Figma|Photoshop|前端|样式|CSS|布局|响应式|动画|过渡|渐变|阴影|字体|排版|design|draw|visual|chart|graph|layout|style/,
  '螺丝咕姆': /代码|写|开发|编程|实现|脚本|函数|类|接口|api|框架|构建|部署|项目|调试|测试|单元测试|集成测试|CI|CD|Git|commit|branch|merge|PR|pull request|重构|优化|性能|数据库|SQL|查询|索引|ORM|后端|前端|全栈|Node|React|Vue|Python|Java|Go|Rust|Type|npm|pip|docker|k8s|容器|微服务|rest|http|code|dev|build|deploy|test|debug|optimiz/,
}
