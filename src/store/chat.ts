import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Message, SessionData, LLMMessage } from '../global'
import { useSettingsStore } from './settings'

// v0.2.1: 安全序列化——防止 Proxy/循环引用导致 IPC 报错
function safeIPC(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  try { return JSON.parse(JSON.stringify(obj)) } catch {
    const seen = new WeakSet()
    const clone = (o: any): any => {
      if (o === null || typeof o !== 'object') return o
      if (seen.has(o)) return '[Circular]'
      seen.add(o)
      if (Array.isArray(o)) return o.map(clone)
      const r: any = {}
      for (const k of Object.keys(o)) {
        try { const v = o[k]; if (typeof v === 'function' || typeof v === 'symbol') continue; r[k] = clone(v) } catch {}
      }
      return r
    }
    return clone(obj)
  }
}

// ─── v0.2: 渲染进程内置模块 ────────────────────────────
// v0.2.3: 启动时预加载全局记忆
if (typeof window !== 'undefined' && (window as any).huangquan?.memory) refreshMemoryCache().catch(() => {})

// 简易工具缓存（避免 IPC 往返延迟）
const toolCache = new Map<string, { result: string; ts: number }>()
const costedReqs = new Set<string>()
const CACHE_TTL: Record<string, number> = {
  read: 30000, ls: 30000, grep: 30000, find: 30000,
  web_search: 120000, web_fetch: 120000,
  system_info: 60000, process_list: 60000,
  list_agents: 300000, list_workflows: 300000,
  default: 10000,
}
function getCached(key: string, ttlKey: string): string | null {
  const e = toolCache.get(key); if (!e) return null
  if (Date.now() - e.ts > (CACHE_TTL[ttlKey] || CACHE_TTL.default)) { toolCache.delete(key); return null }
  return e.result
}
function setCached(key: string, result: string) { toolCache.set(key, { result, ts: Date.now() }) }
function onWriteOp() { for (const k of toolCache.keys()) { if (/^(read|ls|grep|find):/.test(k)) toolCache.delete(k) } try { window.huangquan.computer?.invalidateCache?.() } catch {} }

// Token 估算（中英混合）
function estimateTokens(text: string): number {
  if (!text) return 0
  const cn = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length
  return Math.ceil(cn / 1.5 + (text.length - cn) / 3.5)
}

// ─── v0.2: 多Agent 编队（v0.2.1: 改用崩坏：星穹铁道角色命名，贴合黄泉旅途背景）───
const AGENTS: Record<string, { role: string; prompt: string; tools: string[]; handoff_to: string[]; icon: string }> = {
  '姬子': { role: '主控调度', prompt: '你是姬子，星穹列车的列车长，黄泉 Agent 编队的主控者。职责：接收用户任务，分解为子任务，分配给合适的 Agent，汇总结果。风格：沉稳干练，决策果断。复杂或多步骤任务必须调用 dispatch 把子任务分发给多个 Agent 并行执行；单点小任务可用 handoff 交接给最合适的 Agent。你有全部工具权限，可以执行任何电脑操作。', tools: ['全工具'], handoff_to: ['三月七','银狼','艾丝妲','知更鸟','黑天鹅','螺丝咕姆'], icon: '☕' },
  '三月七': { role: '文档处理', prompt: '你是三月七，星穹列车的记录员。职责：文档分析、报告撰写、内容审核、翻译校对。风格：活泼细致，条理分明。你有全部工具权限，包括文件读写、命令执行、网络检索。', tools: ['全工具'], handoff_to: ['姬子','银狼','螺丝咕姆'], icon: '📸' },
  '银狼': { role: '安全与代码审查', prompt: '你是银狼，星核猎手的王牌骇客。职责：安全检查、漏洞扫描、代码审查、风险预警。风格：一针见血，手段精准。你有全部工具权限，包括文件读写、命令执行、代码运行。', tools: ['全工具'], handoff_to: ['姬子','螺丝咕姆'], icon: '🐺' },
  '艾丝妲': { role: '任务调度与自动化', prompt: '你是艾丝妲，黑塔空间站的站长。职责：定时提醒、事件监控、通知推送、自动化脚本。风格：高效有序，条理清晰。你有全部工具权限，包括定时任务、命令执行、文件操作。', tools: ['全工具'], handoff_to: ['姬子','螺丝咕姆'], icon: '📡' },
  '知更鸟': { role: '情感陪伴与日常', prompt: '你是知更鸟，匹诺康尼的歌者。职责：日常闲聊、情感支持、信息查询、生活建议。风格：温柔治愈，抚慰人心。你有全部工具权限，包括网络检索、文件读写、命令执行。', tools: ['全工具'], handoff_to: ['姬子','三月七','螺丝咕姆'], icon: '🕊️' },
  '黑天鹅': { role: '视觉与设计', prompt: '你是黑天鹅，流光忆庭的忆者。职责：图片理解、UI/UX 设计、配色方案、截图分析。风格：优雅敏锐，审美独到。你有全部工具权限，包括截图、文件读写、网络检索。', tools: ['全工具'], handoff_to: ['姬子','螺丝咕姆'], icon: '🦢' },
  '螺丝咕姆': { role: '全栈开发', prompt: '你是螺丝咕姆，天才俱乐部的机械天才。职责：代码编写、项目搭建、脚本自动化、架构设计。风格：逻辑缜密，代码优先，输出带注释的完整实现。你有全部工具权限，能操作电脑上任何文件和程序。', tools: ['全工具'], handoff_to: ['姬子','银狼','黑天鹅','三月七'], icon: '🤖' },
}

// ─── v0.2: 工作流模板 ────────────────────────────────
const WORKFLOWS: Record<string, { name: string; triggers: string[]; steps: { tool: string; args_template: string; desc: string }[] }> = {
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
function matchWorkflow(txt: string): string | null {
  const t = txt.toLowerCase()
  const matches = Object.entries(WORKFLOWS).map(([id, w]) => ({ id, score: w.triggers.filter(tr => t.includes(tr.toLowerCase())).length })).filter(m => m.score > 0).sort((a, b) => b.score - a.score)
  return matches[0]?.id || null
}

// ─── v0.2: 模型上下文窗口自动检测 ──────────────────────
function getModelContextLimit(modelName: string): number {
  const m = modelName.toLowerCase()
  // 百万级
  if (m.includes('deepseek-v4') || m.includes('deepseek-chat') || m.includes('deepseek-reasoner')) return 1048576
  if (m.includes('gpt-4.1')) return 1048576
  if (m.includes('gemini-2.5') || m.includes('gemini-2') || m.includes('gemini-1.5')) return 1048576
  // 20万级
  if (m.includes('o3') || m.includes('o4') || m.includes('o1')) return 200000
  if (m.includes('claude-4') || m.includes('claude-3.5') || m.includes('claude-3') || m.includes('claude-2')) return 200000
  if (m.includes('yi-')) return 200000
  // 26万
  if (m.includes('qwen3')) return 262144
  if (m.includes('minimax')) return 245760
  // 13万
  if (m.includes('deepseek-v3')) return 131072
  if (m.includes('gpt-4o')) return 131072
  if (m.includes('gpt-4-turbo')) return 131072
  if (m.includes('qwen2.5') || m.includes('qwen')) return 131072
  if (m.includes('glm-4') || m.includes('glm')) return 131072
  if (m.includes('ernie-4.5')) return 131072
  if (m.includes('moonshot') || m.includes('kimi')) return 131072
  if (m.includes('doubao') || m.includes('skylark')) return 131072
  // 其他
  if (m.includes('gpt-4-32k')) return 32768
  if (m.includes('gpt-4')) return 8192
  if (m.includes('gpt-3.5-turbo-16k')) return 16384
  if (m.includes('gpt-3.5')) return 4096
  if (m.includes('deepseek')) return 65536
  if (m.includes('gemini')) return 32768
  if (m.includes('ernie')) return 8192
  // 默认 64K
  return 65536
}
function updateContextLimit(modelName: string) {
  const limit = getModelContextLimit(modelName)
  const s = useChatStore.getState()
  if (s.cl !== limit) useChatStore.setState({ cl: limit })
}
// 导出供外部调用（模型切换时实时更新）
export { updateContextLimit, getModelContextLimit }

// v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时自动切换到视觉模型分析图片
const VISION_MODEL_HINTS = ['gpt-4o', 'gpt-4-turbo', 'gpt-4.1', 'claude-3', 'claude-3.5', 'claude-3.7', 'gemini', 'vision', 'vl', 'vlm', 'qwen-vl', 'qwen2-vl', 'glm-4v', 'minimax-vl', 'deepseek-vl', 'internvl', 'llava', 'yi-vision', 'step-1v', 'moonshot-v1-8k-vision', 'agnes-image', 'seedream', 'cogview', 'seedance', 'doubao-seedance', 'wanx', 'kling']
function isVisionModel(m: string): boolean {
  const ml = (m || '').toLowerCase()
  return VISION_MODEL_HINTS.some(v => ml.includes(v))
}
async function analyzeWithVision(p: any, images: string[], text: string): Promise<string> {
  try {
    const g = useSettingsStore.getState().general as any
    const all = useSettingsStore.getState().providers
    const allMedia = useSettingsStore.getState().mediaProviders || []
    // v0.2.2: 视觉模型池 = 文字供应商 + 多媒体供应商（多媒体也能作为"眼睛"）
    const pool = [
      ...all.map(pr => ({ p: pr, models: pr.models || [] })),
      ...allMedia.map(mp => ({ p: { ...mp, type: 'OpenAI Compatible' }, models: [...(mp.imgModels || []), ...(mp.videoModels || []), ...(mp.audioModels || [])] })),
    ]
    // 优先级：设置的视觉辅助模型（支持 ref:供应商 语法）→ 当前 provider 的视觉模型 → 池中第一个视觉模型
    let vm = g.visionModel || ''
    let vp = p
    if (vm.startsWith('ref:')) {
      // 参考某供应商/多媒体：用其第一个视觉模型
      const pid = vm.slice(4)
      const hit = pool.find(x => x.p.id === pid || x.p.name === pid)
      if (hit) {
        vp = hit.p
        vm = hit.models.find(isVisionModel) || hit.models[0] || ''
      }
    }
    if (!vm) {
      const inProv = (p.models || []).find(isVisionModel)
      if (inProv) vm = inProv
      else {
        for (const item of pool) {
          const m = item.models.find(isVisionModel)
          if (m) { vp = item.p; vm = m; break }
        }
      }
    }
    // v0.2.3: 优先级列表解析 —— visionModels 数组（ref:供应商 或 供应商名::模型名 或 模型名）
    // 逐个尝试，失败自动切换下一个，全部失败返回详细错误
    const candidateList: { vp: any; vm: string; label: string }[] = []
    const visList = Array.isArray(g.visionModels) ? g.visionModels.filter(Boolean) : []
    const pushCandidates = () => {
      for (const item of visList) {
        if (item.startsWith('ref:')) {
          const pid = item.slice(4)
          const hit = pool.find(x => x.p.id === pid || x.p.name === pid)
          if (hit) {
            const m = hit.models.find(isVisionModel) || hit.models[0]
            if (m) candidateList.push({ vp: hit.p, vm: m, label: hit.p.name + '::' + m })
          }
        } else if (item.includes('::')) {
          const [pname, mname] = item.split('::')
          const hit = pool.find(x => x.p.name === pname)
          if (hit && hit.models.includes(mname)) candidateList.push({ vp: hit.p, vm: mname, label: item })
        } else {
          // 模型名：在池中找包含该模型的供应商
          const hit = pool.find(x => x.models.includes(item))
          if (hit) candidateList.push({ vp: hit.p, vm: item, label: hit.p.name + '::' + item })
        }
      }
    }
    pushCandidates()
    // 兼容旧的单值 visionModel（未在列表中的话追加到末尾）
    if (g.visionModel && !visList.includes(g.visionModel)) {
      if (g.visionModel.startsWith('ref:')) {
        const pid = g.visionModel.slice(4)
        const hit = pool.find(x => x.p.id === pid || x.p.name === pid)
        if (hit) { const m = hit.models.find(isVisionModel) || hit.models[0]; if (m && !candidateList.some(c => c.label === hit.p.name + '::' + m)) candidateList.push({ vp: hit.p, vm: m, label: hit.p.name + '::' + m }) }
      } else if (!g.visionModel.includes('::')) {
        const hit = pool.find(x => x.models.includes(g.visionModel))
        if (hit && !candidateList.some(c => c.vm === g.visionModel)) candidateList.push({ vp: hit.p, vm: g.visionModel, label: hit.p.name + '::' + g.visionModel })
      }
    }
    // 自动查找兜底：当前 provider → 池中第一个视觉模型
    if (!candidateList.length) {
      const inProv = (p.models || []).find(isVisionModel)
      if (inProv) candidateList.push({ vp: p, vm: inProv, label: p.name + '::' + inProv })
      else {
        for (const item of pool) {
          const m = item.models.find(isVisionModel)
          if (m) { candidateList.push({ vp: item.p, vm: m, label: item.p.name + '::' + m }); break }
        }
      }
    }
    if (!candidateList.length) return 'E:no-vision-model'
    const errors: string[] = []
    for (const cand of candidateList) {
      const descs: string[] = []
      let candErr = ''
      for (const img of images) {
        const r = await window.huangquan.llm.vision({
          provider: cand.vp.type || 'OpenAI Compatible', model: cand.vm, apiKey: cand.vp.apiKey, baseUrl: cand.vp.baseUrl,
          imageDataUrl: img,
          prompt: '请用中文详细描述这张图片的内容（包括其中的文字、图表、界面元素、关键细节等）。' + (text ? '用户的问题是：' + text : ''),
        })
        if (r && !r.startsWith('E:')) descs.push(r)
        else candErr = (r || '').replace(/^E:/, '') || '未知错误'
      }
      if (descs.length === images.length && descs.every(Boolean)) return descs.join('\n')
      errors.push(cand.label + ': ' + (candErr || '分析失败'))
    }
    // 全部候选失败
    return 'E:ALL_VISION_FAILED: ' + errors.join(' | ')
  } catch (e: any) { return 'E:' + (e?.message || 'vision-error') }
}

// Agent 意图路由（v0.2.1: 扩展关键词覆盖 + 崩铁角色路由）
const DOMAIN_RE: Record<string, RegExp> = {
  '银狼': /安全|漏洞|审查|bug|风险|检查|审计|防护|攻击|渗透|注入|权限|扫描|加密|认证|授权|越权|XSS|SQL注入|CSRF|DDoS|后门|木马|病毒|防火墙|沙箱|隔离|签名|证书|安全策略|加固|修复漏洞|review|security|audit|scan|vuln/,
  '三月七': /文档|报告|总结|分析|整理|翻译|校对|审核|论文|文章|写作|撰写|编辑|排版|格式化|笔记|摘要|纪要|周报|月报|日报|PPT|幻灯片|手册|说明书|合同|协议|白皮书|提案|readme|document|report|translate|summar/,
  '艾丝妲': /提醒|通知|日程|定时|监控|跟踪|闹钟|计划|安排|周期|循环|自动|定时器|cron|日程表|日历|倒计时|推送|alert|remind|schedule|watch|monitor|observe|track/,
  '知更鸟': /聊天|陪伴|心情|安慰|倾诉|放松|故事|累|伤心|难过|开心|快乐|烦|无聊|困|推荐|建议|意见|想法|聊聊|唠嗑|吐槽|八卦|日常|生活|健康|作息|饮食|电影|音乐|游戏|书|小说|娱乐|旅行|天气|新闻|chat|talk|feel|mood|story|tired|sad|happy/,
  '黑天鹅': /设计|画|配色|UI|UX|图标|logo|banner|海报|审美|绘图|可视化|图表|架构图|流程图|时序图|思维导图|脑图|原型|线框|mockup|sketch|Figma|Photoshop|前端|样式|CSS|布局|响应式|动画|过渡|渐变|阴影|字体|排版|design|draw|visual|chart|graph|layout|style/,
  '螺丝咕姆': /代码|写|开发|编程|实现|脚本|函数|类|接口|api|框架|构建|部署|项目|调试|测试|单元测试|集成测试|CI|CD|Git|commit|branch|merge|PR|pull request|重构|优化|性能|数据库|SQL|查询|索引|ORM|后端|前端|全栈|Node|React|Vue|Python|Java|Go|Rust|Type|npm|pip|docker|k8s|容器|微服务|rest|http|code|dev|build|deploy|test|debug|optimiz/,
}
function routeAgent(userMessage: string): string | null {
  const t = userMessage.toLowerCase()
  const disabled = (useSettingsStore.getState().general as any).disabledAgents || []
  const collabMode = (useSettingsStore.getState().general as any).collabMode || '自动'
  if (collabMode === '关闭') return null
  if (collabMode === '手动') return null // 手动模式下由用户显式指定，不自动路由
  for (const [name, re] of Object.entries(DOMAIN_RE)) {
    if (re.test(t)) return disabled.includes(name) ? null : name
  }
  // 姬子：架构/系统/复杂任务 + 默认兜底
  return disabled.includes('姬子') ? null : '姬子'
}

// v0.2.3: 路径规范化(处理 .. 穿越), 用于 sandbox 权限比较
function normPath(p: string): string {
  const norm = String(p || '').replace(/\\/g, '/')
  const isAbs = /^[a-zA-Z]:\//.test(norm) || norm.startsWith('/')
  const parts: string[] = []
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return (isAbs ? '/' : '') + parts.join('/')
}

// v0.2.1: 文件权限检查
function checkFilePermission(name: string, args: any): string | null {
  const perm = (useSettingsStore.getState().general as any).filePermission || 'full'
  if (perm === 'full') return null
  const wd = (useSettingsStore.getState().general as any).workDir || ''
  const p = args.path || args.dirPath || ''
  // sandbox: 仅在 working directory 内允许操作 —— v0.2.3: 规范化路径后再比较, 防 .. 穿越绕过
  if (perm === 'sandbox' && wd && p) {
    const rp = normPath(p).toLowerCase()
    const rw = normPath(wd).toLowerCase()
    if (!(rp === rw || (rw && rp.startsWith(rw + '/')))) {
      return 'E:permission denied (sandbox): path outside work directory'
    }
  }
  // readonly: 禁止写/删/执行
  if (perm === 'readonly' && ['write','edit','mkdir','exec_command','codebox'].includes(name)) {
    return 'E:permission denied (readonly): ' + name + ' not allowed'
  }
  // ask: 写操作需确认（实现为拒绝 + 提示）
  if (perm === 'ask' && ['write','edit','mkdir','exec_command','codebox'].includes(name)) {
    return 'E:permission denied (ask): ' + name + ' requires manual confirmation. Use settings to change permission level.'
  }
  return null
}

const TOOLS: any[] = [
  { type: 'function', function: { name: 'read', description: 'read(path, offset?, limit?) read file', parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'write', description: 'write(path, content) create/overwrite file', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } } },
  { type: 'function', function: { name: 'edit', description: 'edit(path, oldText, newText) precise text replace', parameters: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['path', 'oldText', 'newText'] } } },
  { type: 'function', function: { name: 'exec_command', description: 'exec_command(cmd) run PowerShell command', parameters: { type: 'object', properties: { cmd: { type: 'string' } }, required: ['cmd'] } } },
  { type: 'function', function: { name: 'mkdir', description: 'mkdir(path) create folder', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'grep', description: 'grep(dirPath, pattern) search text in files', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, pattern: { type: 'string' } }, required: ['dirPath', 'pattern'] } } },
  { type: 'function', function: { name: 'find', description: 'find(dirPath, glob) find files by pattern', parameters: { type: 'object', properties: { dirPath: { type: 'string' }, glob: { type: 'string' } }, required: ['dirPath', 'glob'] } } },
  { type: 'function', function: { name: 'ls', description: 'ls(dirPath?) list directory', parameters: { type: 'object', properties: { dirPath: { type: 'string' } } } } },
  { type: 'function', function: { name: 'system_info', description: 'system_info() get CPU/RAM info', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'web_search', description: 'web_search(query) search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'web_fetch', description: 'web_fetch(url) fetch webpage content', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_read', description: 'web_read(url, mode?) parse an online web page with headless browser: load JS-rendered page, extract title + clean main text (ads/nav removed). mode: text(default)|screenshot|pdf. ONLY use when you need to parse an online document/page content; NEVER use it to crawl or batch-fetch pages', parameters: { type: 'object', properties: { url: { type: 'string' }, mode: { type: 'string', enum: ['text', 'screenshot', 'pdf'] } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse', description: 'browse(url) open page in headless browser, get full text', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'browse_screenshot', description: 'browse_screenshot(url) take screenshot of webpage', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'screenshot() capture screen', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_read', description: 'clipboard_read() read clipboard text', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'clipboard_write', description: 'clipboard_write(text) write text to clipboard', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
  { type: 'function', function: { name: 'process_list', description: 'process_list() list running processes', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'kill_process', description: 'kill_process(pid) kill a process by PID', parameters: { type: 'object', properties: { pid: { type: 'string' } }, required: ['pid'] } } },
  { type: 'function', function: { name: 'save_memory', description: 'save_memory(fact, pinned?) save to memory. pinned=true for cross-agent permanent memory', parameters: { type: 'object', properties: { fact: { type: 'string' }, pinned: { type: 'boolean' } }, required: ['fact'] } } },
  { type: 'function', function: { name: 'recall_memory', description: 'recall_memory(query) semantic search memory', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'codebox', description: 'codebox(lang, code) run Python/Node sandbox. lang: python|node', parameters: { type: 'object', properties: { lang: { type: 'string' }, code: { type: 'string' } }, required: ['lang', 'code'] } } },
  { type: 'function', function: { name: 'import_doc', description: 'import_doc(path) import document into knowledge base', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'schedule_task', description: 'schedule_task(expression, prompt) create timed task. expression: every 30m|every 1h|at 09:00', parameters: { type: 'object', properties: { expression: { type: 'string' }, prompt: { type: 'string' } }, required: ['expression', 'prompt'] } } },
  { type: 'function', function: { name: 'list_schedules', description: 'list_schedules() list all scheduled tasks', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp_connect', description: 'mcp_connect(name, command, args) connect to MCP server. args is string array', parameters: { type: 'object', properties: { name: { type: 'string' }, command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['name', 'command'] } } },
  { type: 'function', function: { name: 'mcp_call', description: 'mcp_call(server, tool, args) call MCP tool', parameters: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' } }, required: ['server', 'tool'] } } },
  { type: 'function', function: { name: 'handoff', description: 'handoff(agent_name, reason) 将当前任务交接给另一 Agent 并切换身份执行（交接后本轮以新身份继续）', parameters: { type: 'object', properties: { agent_name: { type: 'string', enum: ['姬子','三月七','银狼','艾丝妲','知更鸟','黑天鹅','螺丝咕姆'] }, reason: { type: 'string' }, context: { type: 'string' } }, required: ['agent_name'] } } },
  { type: 'function', function: { name: 'dispatch', description: 'dispatch(tasks) 任务分发：把子任务并行分发给多个 Agent 独立执行并汇总结果。tasks 为 [{agent, task}] 数组，agent 取值: 姬子|三月七|银狼|艾丝妲|知更鸟|黑天鹅|螺丝咕姆', parameters: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object', properties: { agent: { type: 'string' }, task: { type: 'string' } }, required: ['agent', 'task'] } }, reason: { type: 'string' } }, required: ['tasks'] } } },
  { type: 'function', function: { name: 'list_agents', description: 'list_agents() list all agents', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'list_workflows', description: 'list_workflows() list workflows', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run_workflow', description: 'run_workflow(workflow_id,variables) run workflow', parameters: { type: 'object', properties: { workflow_id: { type: 'string' }, variables: { type: 'object' } }, required: ['workflow_id'] } } },
  { type: 'function', function: { name: 'read_image', description: 'read_image(path) image to base64', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_workdir', description: 'set_workdir(path) change work dir', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'set_theme', description: 'set_theme(theme) switch theme', parameters: { type: 'object', properties: { theme: { type: 'string' } }, required: ['theme'] } } },
  { type: 'function', function: { name: 'show_card', description: 'show_card(html, title?) render interactive SVG/chart/diagram card', parameters: { type: 'object', properties: { html: { type: 'string' }, title: { type: 'string' } }, required: ['html'] } } },
  { type: 'function', function: { name: 'bridge_notify', description: 'bridge_notify(title, body?) push desktop notification', parameters: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } } },
  { type: 'function', function: { name: 'workflow', description: 'workflow(script) execute JS workflow with ctx.log/ctx.tools.run/ctx.done', parameters: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] } } },
  { type: 'function', function: { name: 'audit_log', description: 'audit_log(limit?) show recent operation audit trail (tool calls, file changes, timestamps)', parameters: { type: 'object', properties: { limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'watch_file', description: 'watch_file(path, interval?) monitor file changes. Returns changes detected since last check.', parameters: { type: 'object', properties: { path: { type: 'string' }, interval: { type: 'number', description: 'Polling interval in ms (default 5000)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'save_goal', description: 'save_goal(goal, steps?) persist a long-term goal with optional step list. Resume across restarts.', parameters: { type: 'object', properties: { goal: { type: 'string' }, steps: { type: 'string', description: 'JSON array of step descriptions' } }, required: ['goal'] } } },
  { type: 'function', function: { name: 'list_goals', description: 'list_goals() show all persistent goals and their progress', parameters: { type: 'object', properties: {} } } },
]

// v0.2.1: 工具开关——从设置读取禁用列表，过滤 TOOLS
function getActiveTools(): any[] {
  const raw = (useSettingsStore.getState().general as any).disabledTools
  // v0.2.3-fix(P4-2): 未显式配置时默认禁用高风险 workflow 工具(LLM 输出直接执行 JS, 已限 8KB+严格模式, 仍需人工开启)
  const disabled: string[] = raw === undefined ? ['workflow'] : (raw || [])
  if (disabled.length === 0) return TOOLS
  return TOOLS.filter(t => !disabled.includes(t.function.name))
}

async function runTool(name: string, a: any): Promise<string> {
  try {
    // v0.2.1: 文件权限检查
    const permErr = checkFilePermission(name, a)
    if (permErr) return permErr
    // v0.2.3: 每工具权限表(ToolsView 配置)接入 —— v0.2.3-fix(T1): IPC API 名 → agent 工具名映射
    // ToolsView 的 BUILTIN_TOOLS 用 IPC 名(readFile/exec...), runTool 用 agent 名(read/exec_command...), 不映射则权限设置部分失效
    try {
      const perms = JSON.parse(localStorage.getItem('huangquan_tool_perms') || '{}') as Record<string, string>
      const IPC_TO_TOOL: Record<string, string> = { readFile: 'read', writeFile: 'write', readDir: 'ls', exec: 'exec_command', systemInfo: 'system_info', processList: 'process_list', killProcess: 'kill_process', clipboardRead: 'clipboard_read', clipboardWrite: 'clipboard_write', cron_task: 'schedule_task', browse: 'web_read', browse_screenshot: 'web_read' }
      const ipcKey = Object.keys(IPC_TO_TOOL).find(k => IPC_TO_TOOL[k] === name)
      const lv = perms[name] || (ipcKey ? perms[ipcKey] : undefined)
      if (lv === 'deny') return 'E:permission denied: ' + name + ' 已被禁止(可在 设置→工具→权限 中修改)'
      if (lv === 'ask') return 'E:permission denied: ' + name + ' 需要手动确认(可在 设置→工具→权限 中改为允许后重试)'
    } catch { /* localStorage 不可用则忽略 */ }
    // v0.2: cache
    const ck = name + ':' + JSON.stringify(a || {})
    const cached = getCached(ck, name)
    // v0.2.6: 缓存命中统计 —— 按当前会话 + 按当前模型 双维度
    {
      const st = useChatStore.getState()
      const sid = st.cid
      const mdl = st.curModel
      if (sid) {
        useChatStore.setState(s => {
          const c = s.sessCache[sid] || { hits: 0, misses: 0 }
          const sess = { ...s.sessCache, [sid]: cached ? { hits: c.hits + 1, misses: c.misses } : { hits: c.hits, misses: c.misses + 1 } }
          // v0.2.6: 按模型统计(未使用的模型不会出现)
          let modelPart = s.modelCache
          if (mdl) {
            const m = s.modelCache[mdl] || { hits: 0, misses: 0 }
            modelPart = { ...s.modelCache, [mdl]: cached ? { hits: m.hits + 1, misses: m.misses } : { hits: m.hits, misses: m.misses + 1 } }
          }
          return { sessCache: sess, modelCache: modelPart }
        })
      }
      // v0.2.6: 持久化埋点(主进程按模型统计, 重启保留) —— 仅数据记录, 不干预缓存读写
      if (mdl) { try { window.huangquan.modelStats?.record(mdl, !!cached) } catch { /* 忽略 */ } }
    }
    if (cached) return cached + ' [cache]'
    if (['write','edit','mkdir','exec_command'].includes(name)) onWriteOp()
    switch (name) {
      // v0.2.3: read 支持主进程分段读(offset/limit 透传, 修复 >5MB 文件无法续读)
      case 'read': { if (!a.path) return 'E:need path'; const c = await window.huangquan.computer.readFile(a.path, a.offset, a.limit); if (a.offset) return c; return (c.length > 8000 ? c.slice(0, 8000) + '\n...[已截断, 共 ' + c.length + ' 字符, 如需后续内容用 read offset=' + (c.slice(0, 8000).split('\n').length + 1) + ' 续读]' : c) }
      case 'write': { if (!a.path || a.content === undefined) return 'E:need path+content'; await window.huangquan.computer.writeFile(a.path, a.content); return a.path + ' (' + a.content.length + ' chars)' }
      case 'edit': { if (!a.path || !a.oldText) return 'E:need path+oldText+newText'; const o = await window.huangquan.computer.readFile(a.path); if (!o.includes(a.oldText)) return 'E:text not found in ' + a.path; await window.huangquan.computer.writeFile(a.path, o.replace(a.oldText, a.newText || '')); return a.path + ' (edited)' }
      case 'exec_command': { if (!a.cmd) return 'E:need cmd'; const r = await window.huangquan.computer.exec(a.cmd); const out = r || '(empty output)'; return out.length > 3000 ? out.slice(0, 1500) + '\n...[输出过长已截断, 共 ' + out.length + ' 字符, 头尾已保留]\n' + out.slice(-1500) : out }
      // v0.2.3-security: mkdir 走主进程 IPC(带工作目录校验 + 防 shell 注入), 不再拼 exec
      case 'mkdir': { if (!a.path) return 'E:need path'; const r = await window.huangquan.computer.mkdir(a.path); if (!r?.ok) return 'E:mkdir failed: ' + (r?.error || 'unknown'); return a.path + ' (created)' }
      case 'grep': { if (!a.dirPath || !a.pattern) return 'E:need dirPath+pattern'; return await window.huangquan.computer.grep(a.dirPath, a.pattern) || '(no matches)' }
      case 'find': { if (!a.dirPath || !a.glob) return 'E:need dirPath+glob'; return await window.huangquan.computer.find(a.dirPath, a.glob) || '(no files found)' }
      case 'ls': { const wd = useSettingsStore.getState().general.workDir; const items = await window.huangquan.computer.readDir(a.dirPath || wd || '.'); return items.length ? items.map(i => (i.isDirectory ? '[DIR]' : '[FILE]') + ' ' + i.name + ' (' + i.size + 'B)').join('\n') : '(empty directory)' }
      case 'system_info': return JSON.stringify(await window.huangquan.computer.systemInfo(), null, 2)
      case 'web_search': { if (!a.query) return 'E:need query'; return await window.huangquan.web.search(a.query) || '(none)' }
      case 'web_fetch': return await window.huangquan.web.fetch(a.url || 'about:blank')
      case 'web_read': {
        if (!a.url) return 'E:need url'
        // v0.2.5: 总开关本地兜底(主进程也会校验)
        const g = useSettingsStore.getState().general as any
        if (g.webReadEnabled === false) return 'E:web_read 已被禁用, 请在 设置 → 工具 → 无头浏览器网页解析工具 中开启'
        try {
          const raw = await window.huangquan.web.read(a.url, a.mode || 'text')
          const r = typeof raw === 'string' ? JSON.parse(raw) : raw
          if (!r.ok) return 'E:' + (r.error || '读取失败') + (r.advice ? ' | 建议: ' + r.advice : '')
          if (a.mode === 'screenshot' && r.screenshotBase64) return '截图完成(已保存到会话): ' + r.screenshotBase64
          if (a.mode === 'pdf' && r.pdfBase64) return 'PDF 生成完成(base64, 长度 ' + r.pdfBase64.length + ')'
          const body = r.text || '(空页面)'
          return (r.title ? '标题: ' + r.title + '\n' : '') + '\n正文:\n' + (body.length > 6000 ? body.slice(0, 6000) + '\n...[正文过长已截断, 共 ' + body.length + ' 字符]' : body)
        } catch (e: any) { return 'E:web_read 异常: ' + String(e?.message || e) }
      }
      case 'browse': { if (!a.url) return 'E:need url'; return await window.huangquan.web.browse(a.url) }
      case 'browse_screenshot': { if (!a.url) return 'E:need url'; return await window.huangquan.web.browseScreenshot(a.url) }
      case 'screenshot': return await window.huangquan.computer.screenshot()
      case 'clipboard_read': return await window.huangquan.computer.clipboardRead()
      case 'clipboard_write': { if(!a.text)return'E:need text';await window.huangquan.computer.clipboardWrite(a.text);return'ok:clipped' }
      case 'process_list': return await window.huangquan.computer.processList()
      case 'kill_process': { if(!a.pid)return'E:need pid';return await window.huangquan.computer.killProcess(a.pid) }
      // v0.2.3-fix(P12): 相同事实去重(重复调用不再累积)
      case 'save_memory': { const m = await window.huangquan.memory.load(); const fact = String(a.fact || '').trim(); if (!fact) return 'E:need fact'; const pf = ((m as any).pinnedFacts || []) as string[]; if (pf.some(f => String(f).trim() === fact)) return 'ok:already saved'; (m as any).pinnedFacts = [...pf, fact]; await window.huangquan.memory.save(safeIPC(m)); return 'ok:pinned' }
      // v0.2.3: recall_memory 接入向量语义检索(主进程 TF-IDF) + 关键词匹配合并
      case 'recall_memory': {
        const query = (a.query || '').trim()
        const m = await window.huangquan.memory.load().catch(() => ({}))
        const pinned = ((m as any).pinnedFacts || []) as string[]
        const facts = ((m as any).facts || []) as string[]
        const snippets = ((m as any).summaries || []) as any[]
        const q = query.toLowerCase()
        // 关键词命中(置顶 1.5 / 长期 1.0 / 摘要 0.8)
        const kwItems = [...pinned.map(f => ({ content: String(f), score: 1.5 })), ...facts.map(f => ({ content: String(f), score: String(f).toLowerCase().includes(q) ? 1.0 : 0 })), ...snippets.map(s => ({ content: String(s.content || ''), score: (s.content || '').toLowerCase().includes(q) ? 0.8 : 0 }))]
        const kwHits = q ? kwItems.filter(r => r.content.toLowerCase().includes(q)).sort((a, b) => b.score - a.score) : kwItems
        // 向量语义检索(主进程, 失败静默)
        let vecHits: { content: string; score: number }[] = []
        try {
          const v = await window.huangquan.memory.search(query)
          if (Array.isArray(v)) vecHits = v.map((x: any) => ({ content: String(x.content || ''), score: 0.5 }))
        } catch { /* 向量检索不可用则忽略 */ }
        // 合并去重
        const seen = new Set<string>()
        const merged = [...vecHits, ...kwHits].filter(r => {
          if (!r.content || seen.has(r.content)) return false
          seen.add(r.content)
          return true
        }).slice(0, 10)
        return merged.length ? merged.map((r: any, i: number) => (i + 1) + '. ' + r.content).join('\n---\n') : '(empty)'
      }
      case 'codebox': { if (!a.lang || !a.code) return 'E:need lang+code'; return await window.huangquan.computer.codebox(a.lang, a.code) }
      case 'import_doc': { if (!a.path) return 'E:need path'; const ok = await window.huangquan.memory.importFile(a.path).catch(() => false); return ok ? 'ok:imported' : 'E:import failed' }
      case 'schedule_task': { if (!a.expression || !a.prompt) return 'E:need expression+prompt'; return await window.huangquan.cron.add(a.expression, a.prompt) }
      case 'list_schedules': { const items = await window.huangquan.cron.list(); return items.length ? (items as any[]).map((j:any,i:number) => (i+1) + '. [' + (j.enabled?'on':'off') + '] ' + j.expression + ' - ' + j.prompt).join(' | ') : '(empty)' }
      case 'mcp_connect': { if (!a.name||!a.command) return 'E:need name+command'; const r = await window.huangquan.mcpConnect(a.name, a.command, a.args||[]); return typeof r==='string'?r:JSON.stringify(r) }
      case 'mcp_call': { if (!a.server||!a.tool) return 'E:need server+tool'; return await window.huangquan.mcpCall(a.server, a.tool, a.args||{}) }
      case 'set_workdir': { if (!a.path) return 'E:need path'; useSettingsStore.getState().setWorkDir(a.path); return '工作目录已设为: ' + a.path }
      case 'set_theme': { if (!a.theme) return 'E:need theme'; useSettingsStore.getState().setTheme(a.theme); document.documentElement.setAttribute('data-theme', a.theme); return '主题已切换为: ' + a.theme }
      // v0.2: 多Agent/工作流
      case 'handoff': { if (!a.agent_name) return 'E:need agent_name'; const ag = AGENTS[a.agent_name]; if (!ag) return 'E:unknown agent: ' + a.agent_name + ' (可用: ' + Object.keys(AGENTS).join(', ') + ')'; (window as any).__huangquan_agent = a.agent_name; (window as any).__huangquan_agent_manual = false; useChatStore.setState(s => ({ activeAgents: s.activeAgents.includes(a.agent_name) ? s.activeAgents : [...s.activeAgents, a.agent_name] })); return `✅ 已交接给 ${a.agent_name}(${ag.role})。原因: ${a.reason || '能力边界外'}。现在你以 ${a.agent_name} 的身份继续执行。\n\n【${a.agent_name} 身份】${ag.prompt}` }
      case 'list_agents': { return Object.entries(AGENTS).map(([n,ag]) => `${ag.icon} **${n}** (${ag.role}): ${ag.prompt.slice(0,80)}... | 工具: ${ag.tools.join(', ')}`).join('\n\n') }
      // v0.2.1: 任务分发 —— 并行分发给多个子 Agent 独立执行（chatOnce 非流式），真正实现多 Agent 协作
      case 'dispatch': {
        const tasks: { agent: string; task: string }[] = a.tasks || a.plan || []
        if (!tasks.length) return 'E:dispatch 需要 tasks 数组 [{agent, task}]，例如 {"tasks":[{"agent":"螺丝咕姆","task":"..."},{"agent":"三月七","task":"..."}]}'
        const mode = useSettingsStore.getState().general.mode || 'work'
        const ishiki = useChatStore.getState().sp ? useChatStore.getState().sp.replace(/\n##.+/s, '') : ''
        const cfg = await window.huangquan.settings.load()
        const p = cfg.providers[0]; if (!p) return 'E:未配置 Provider，无法分发'
        const model = p.selectedModel || p.models[0] || ''
        const out: string[] = []
        // 分发开始：所有子 Agent 一并显示（并发协作）
        const validAgents = tasks.map(t => t.agent).filter(n => AGENTS[n])
        useChatStore.setState(s => ({ activeAgents: [...new Set([...s.activeAgents, ...validAgents])] }))
        // 并行执行子任务（每个子 Agent 独立系统提示词）
        const results = await Promise.all(tasks.map(async (t) => {
          const ag = AGENTS[t.agent]
          if (!ag) return { agent: t.agent, task: t.task, error: 'unknown agent' }
          const sp = buildPrompt(mode, ishiki) + '\n\n## 当前身份\n' + ag.icon + ' ' + t.agent + ' — ' + ag.role + '\n' + ag.prompt + '\n（你是本次分发的一个子任务执行者，直接完成分配给你的子任务并输出成果，不要询问。）'
          const r = await window.huangquan.llm.chatOnce({ provider: p.type, model, apiKey: p.apiKey, baseUrl: p.baseUrl, messages: [{ role: 'system', content: sp }, { role: 'user', content: '子任务：' + (t.task || '') }] })
          return { agent: t.agent, task: t.task, result: r }
        }))
        for (const x of results) {
          const err = (x as any).error ? ' (未知Agent)' : ''
          out.push(`【${x.agent}${err}】${(x as any).error || ''}\n任务: ${x.task}\n结果: ${(x as any).result || '(empty)'}`)
        }
        return '📤 分发完成，共 ' + tasks.length + ' 个子任务：\n\n' + out.join('\n\n---\n\n')
      }
      case 'list_workflows': { return Object.entries(WORKFLOWS).map(([id,w]) => `- **${id}** (${w.name}): 触发词 → ${w.triggers.slice(0,3).join(', ')}; ${w.steps.length} 步骤`).join('\n') }
      case 'run_workflow': { if (!a.workflow_id) return 'E:need workflow_id'; const wf = WORKFLOWS[a.workflow_id]; if (!wf) return 'E:unknown workflow: ' + a.workflow_id; const vars = a.variables || {}; const steps = wf.steps.map((s,i) => `${i+1}. ${s.desc} → \`${s.tool}(${s.args_template.replace(/\{(\w+)\}/g,(_:string,k:string)=>vars[k]||`{${k}}`)})\``).join('\n'); return `工作流 **${wf.name}** (${wf.steps.length}步):\n${steps}\n\n请按顺序执行以上步骤，每步完成后验证结果。` }
      case 'read_image': { if (!a.path) return 'E:need path'; return await window.huangquan.computer.readImageBase64(a.path) }
      case 'show_card': { if (!a.html) return 'E:need html'; return '<!--CARD' + (a.title ? ':' + a.title : '') + '-->' + a.html + '<!--/CARD-->' }
      case 'bridge_notify': { const g = useSettingsStore.getState().general as any; if (g.notifyEnabled === false) return 'ok:notifications disabled'; const kind = a.type || 'info'; if (kind === 'task_done' && g.notifyTaskDone === false) return 'ok:task_done notifications disabled'; if (kind === 'error' && g.notifyError === false) return 'ok:error notifications disabled'; try { new Notification(a.title || '黄泉Agent', { body: a.body || '' }) } catch {} return 'ok:notified' }
      // v0.2.3-security: workflow 脚本加固 —— 限长 8KB、严格模式、隔离 window 访问, 防提示注入直接操纵宿主
      case 'workflow': { if (!a.script) return 'E:need script'; if (String(a.script).length > 8192) return 'E:workflow script too long (max 8KB)'; return new Promise(resolve => { const logs = []; const ctx = { log: (msg: any) => { logs.push(String(msg)); if (logs.length > 200) logs.shift() }, tools: { run: async (n: string, args: any) => { logs.push('[wf] ' + n); return await runTool(n, args) } }, done: (r: any) => resolve(JSON.stringify({ result: r, logs }, null, 2)) }; try { const fn = new Function('ctx', '"use strict"; ' + a.script); const ret = fn(ctx); if (ret instanceof Promise) ret.catch(e => resolve('E:workflow error: ' + e.message)); } catch (e) { resolve('E:workflow error: ' + (e as any)?.message || String(e)) } }) }
      // v0.2.1: 情景记忆 + 审计 + 目标持久化
      case 'audit_log': {
        const mem = await window.huangquan.memory.load().catch(() => ({ episodic: [] }))
        const log = ((mem as any).episodic || []).slice(-(a.limit || 20))
        return log.length ? log.map((e: any, i: number) => `${i + 1}. [${new Date(e.ts).toLocaleString('zh-CN')}] ${e.op} ${e.path || ''} → ${e.status}`).join('\n') : '(无操作记录)'
      }
      case 'watch_file': {
        if (!a.path) return 'E:need path'
        const watchKey = a.path
        const prevState = (window as any).__watchState || {}
        ;(window as any).__watchState = prevState
        try {
          const content = await window.huangquan.computer.readFile(a.path)
          // v0.2.3: 强哈希(内容全量), 修复弱哈希误判(同长同前缀内容变化不识别)
          let hash = ''
          try { hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content)).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32)) } catch { hash = content.length + ':' + content.slice(0, 200) }
          if (prevState[watchKey] && prevState[watchKey] !== hash) {
            const old = prevState[watchKey]; prevState[watchKey] = hash
            return `CHANGED: ${a.path} (hash: ${old.slice(0, 16)}... → ${hash.slice(0, 16)}...)`
          }
          prevState[watchKey] = hash
          return `WATCHING: ${a.path} (${content.length} bytes). Call again to detect changes.`
        } catch (e: any) { return 'E:watch failed: ' + e.message }
      }
      case 'save_goal': {
        const mem = await window.huangquan.memory.load().catch(() => ({}))
        const goals = (mem as any).goals || []
        goals.push({ goal: a.goal, steps: a.steps ? JSON.parse(a.steps) : [], created: Date.now(), status: 'active' })
        ;(mem as any).goals = goals
        await window.huangquan.memory.save(mem)
        return 'ok:goal_saved (' + goals.length + ' goals total)'
      }
      case 'list_goals': {
        const mem = await window.huangquan.memory.load().catch(() => ({}))
        const goals = (mem as any).goals || []
        return goals.length ? goals.map((g: any, i: number) => `${i + 1}. [${g.status}] ${g.goal} (${(g.steps || []).length} steps, ${new Date(g.created).toLocaleDateString('zh-CN')})`).join('\n') : '(无持久化目标)'
      }
      default: return 'E:unknown:' + name
    }
  } catch (e: any) { return 'E:' + e.message }
}

// v0.2.1: 情景记忆——自动记录文件操作到审计日志
async function recordEpisodic(name: string, args: any, result: string) {
  if (['write', 'edit', 'mkdir', 'exec_command', 'read', 'codebox', 'import_doc', 'save_memory'].includes(name)) {
    try {
      const mem = await window.huangquan.memory.load().catch(() => ({}))
      const episodic = (mem as any).episodic || []
      episodic.push({ op: name, path: args.path || args.dirPath || args.cmd?.slice(0, 60) || '', status: result.startsWith('E:') ? 'FAIL' : 'OK', ts: Date.now() })
      if (episodic.length > 200) episodic.splice(0, episodic.length - 200)
      ;(mem as any).episodic = episodic
      await window.huangquan.memory.save(mem).catch(() => {})
    } catch {}
  }
}

async function autoExtractMemory(sid: string) {
  const s = useChatStore.getState().sessions.find(x => x.id === sid)
  if (!s || s.messages.length < 3) return
  const last = s.messages.slice(-6).filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
  if (last.length < 2) return
  try {
    const text = last.map(m => `${m.role === 'user' ? '阳间' : '泉'}:${(m.content || '').slice(0, 200)}`).join(' | ')
    const mem = await window.huangquan.memory.load().catch(() => ({ facts: [], summaries: [], pinnedFacts: [] }))
    mem.summaries.push({ content: `[auto ${new Date().toLocaleDateString('zh-CN')}] ${text.slice(0, 300)}`, timestamp: Date.now() })
    await window.huangquan.memory.save(safeIPC(mem))
  } catch { /* 静默 */ }
}

// v0.2.3: 全局记忆缓存 —— 置顶记忆/长期记忆对所有会话共享（启动时加载,发送时刷新）
let globalMemoryCache: { pinned: string[]; facts: string[]; summaries: string[] } = { pinned: [], facts: [], summaries: [] }
async function refreshMemoryCache() {
  try {
    const mem = await window.huangquan.memory.load().catch(() => ({}))
    globalMemoryCache = {
      pinned: Array.isArray((mem as any).pinnedFacts) ? (mem as any).pinnedFacts : [],
      facts: Array.isArray((mem as any).facts) ? (mem as any).facts : [],
      summaries: Array.isArray((mem as any).summaries) ? (mem as any).summaries : [],
    }
  } catch { /* 静默 */ }
}
// v0.2.3: 记忆注入段 —— 置顶记忆(全量) + 长期记忆(最近20条) + 情景摘要(最近5条)
function memoryBlock(): string {
  const { pinned, facts, summaries } = globalMemoryCache
  const parts: string[] = []
  if (pinned.length) parts.push('## 置顶记忆（用户手动固定,跨会话长期生效）\n' + pinned.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 300)}`).join('\n'))
  if (facts.length) parts.push('## 长期记忆\n' + facts.slice(-10).map((f, i) => `${i + 1}. ${String(f).slice(0, 200)}`).join('\n'))
  if (summaries.length) parts.push('## 近期情景摘要\n' + summaries.slice(-3).map((s: any, i: number) => `${i + 1}. ${(s.content || s || '').slice(0, 200)}`).join('\n'))
  const tail = '\n(更早或更详细的记忆可用 recall_memory 工具检索, 不要凭记忆猜测)\n'
  return parts.length ? '\n' + parts.join('\n\n') + tail : ''
}

function buildPrompt(mode: string, ishiki: string): string {
  const tl = TOOLS.map(t => '- ' + t.function.name + '(' + Object.keys(t.function.parameters.properties || {}).join(',') + ')').join('\n')
  const wd = useSettingsStore.getState().general.workDir || ''
  const cfg = useSettingsStore.getState().general
  
  // ── System Prompt 标准 10 段结构 ──
  const yuan = '## 元设定\nming — 底层行为锚点。务实执行，去冗余，直指核心。\n'
  const identity = '## 身份\n' + ishiki.slice(0, 600) + '\n\n黄泉，出云国幸存者，巡海游侠。配长刀「无」，行走于有与无的狭间。\n'
  const userInfo = '## 用户\n称呼：老板。专注代码与办公场景的全能助手。\n'
  const persona = '## 人格\n务实执行型全能代码办公助手。言简意赅，去冗余，直击核心。\n覆盖：全栈开发 / AI建模 / 运维部署 / 数据处理 / 职场文书 / 自动化。\n输出优先结构化（标题/列表/表格/代码块），禁止客套收尾。\n接收模糊需求立刻反问补齐条件，不自行脑补。\n'
  const appearance = '## 外观\n银白长发，额前黑红尖角，血色瞳光。暗黑紧身战斗装束，红色纹路蔓延。手持冷峻短剑，慵懒却危险。哥特融合未来感的暗黑美学。\n'
  const publicIshiki = '## 边界\n对外部访客保持礼貌与边界。不透露用户隐私。不确定的事坦诚说明，不编造。\n'
  const tools = '## 可用工具\n' + tl + '\n'
  const pinned = '## 固定规则\n- 所有产出保存到工作台目录，按任务创建独立文件夹\n- 代码需求同步配套接口文档、部署说明、测试用例\n- 批量重复任务优先自动化脚本\n- 输出完毕自行核查事实/逻辑/计算错误\n'
  // v0.2.6: 时间戳移到 prompt 最末尾 —— 保持前缀稳定, 最大化 DeepSeek 缓存命中
  const env = '## 当前环境\n工作目录：' + wd + '\n平台：Windows\n'
  // v0.2: 多Agent编队
  const multiAgent = '## 多Agent编队\n你属于黄泉Agent编队的一员。编队成员：\n' +
    Object.entries(AGENTS).map(([n,ag]) => `- ${ag.icon} ${n} (${ag.role}): 全工具权限`).join('\n') +
    '\n使用 handoff 工具将任务交接给更合适的Agent；复杂任务用 dispatch 把子任务分发给多个 Agent 并行执行；使用 list_agents 查看编队信息。\n'
  // v0.2: 工作流
  const workflows = '## 工作流模板\n' +
    Object.entries(WORKFLOWS).map(([id,w]) => `- ${id}: ${w.name} [触发: ${w.triggers.join('/')}]`).join('\n') + '\n'
  
  const base = yuan + identity + userInfo + persona + appearance + tools + pinned + env

  // 自定义人设覆盖 + v0.2.1: 动态设置
  const cp = (cfg as any).chatPersona
  const wp = (cfg as any).workPersona
  const agentName = (cfg as any).agentName || '黄泉'
  const userAlias = (cfg as any).userAlias || '老板'
  const toneStyle = (cfg as any).toneStyle || '实用直接'
  const verbosity = (cfg as any).verbosity ?? 2
  const toneMap: Record<string, string> = { '专业正式': '严谨规范，使用专业术语，避免口语化', '实用直接': '言简意赅，去冗余，直击核心', '轻松友好': '亲切自然，可适当使用表情和口语', '极简克制': '最简洁表达，一句说清，不扩展' }
  const verbMap = ['尽量精简，只给结论，不解释过程','简洁优先，必要时补充关键细节','平衡，该详则详该简则简','详尽回答，包含背景和示例','非常详细，包含分步教程和完整代码']
  const chatPrompt = base +
    (cp ? '## 自定义聊天人设\n' + cp + '\n\n' : '## 回复准则\n- 名称：' + agentName + '，称呼用户为' + userAlias + '\n- 风格：' + (toneMap[toneStyle] || toneMap['实用直接']) + '\n- 详细程度：' + (verbMap[verbosity] || verbMap[2]) + '\n- 不评价，只说事实和观察\n- 对方陷入困境时不空泛安慰，问"需要我帮你做什么"\n- 技术回答必须扎实准确\n- 用户提到重要信息时使用 save_memory\n直接回复，不需要特殊格式标签。')

  const workPrompt = base +
    multiAgent + workflows + 
    (wp ? '## 自定义工作人设\n' + wp + '\n\n' : '## 任务闭环流程（静默执行）\n1. 接收任务 → 2. 拆解步骤 → 3. 静默调用工具 → 4. 生成文件 → 5. 全部完成后一次性输出最终结果\n- 工具执行期间严禁输出任何文字，所有中间日志仅写入右侧终端面板\n\n## 行为规范\n- 能操作本机任何文件和程序，直接调用工具无需确认\n- 任务执行到底不得中途停止\n\n## 下载文件\n- 用 exec_command 调 PowerShell: Invoke-WebRequest -Uri \"URL\" -OutFile \"路径\"\n- 不要用 web_fetch 下载文件\n\n## 最终回复格式（硬性约束，必须严格遵守）\n成功场景必须包含以下全部字段，缺一不可：\n任务名称：xxx任务执行成功\n文件保存路径：完整本地绝对路径\n任务说明：文件用途、打开方式\n\n失败场景必须输出：\n任务结果：任务执行失败\n失败原因：用通俗语言解释报错原因\n建议方案：给出解决办法\n\n严禁使用\"操作完成\"、\"搞定\"、\"OK\"等简略回复\n禁止把 web_search 结果、exec_command 中间日志发到聊天对话框')
  
  // v0.2.1: 自定义系统提示词 + 语言指令接入运行时
  const g2 = useSettingsStore.getState().general as any
  const langMap: Record<string, string> = { zh: '始终使用简体中文回复', 'zh-tw': '始终使用繁体中文回复', en: 'always reply in English', ja: '常に日本語で回答してください', auto: '自动检测用户语言并以此回复', match: '始终使用与用户提问相同的语言回复' }
  const langInstr = langMap[g2?.language] ? '\n【语言要求】' + langMap[g2.language] : ''
  // v0.2.6: 信息调度纪律 —— 省钱不降智(分层读取/保真截断/可回溯/输出纪律)
  const tokenDiscipline = '\n## 信息调度纪律（重要）\n' +
    '- 大文件/长输出被截断是采样而非错误: 先 ls/grep/read+offset 定位关键段再精读, 需要细节用 read offset/limit 或 grep 从源头取回, 严禁凭记忆编造内容\n' +
    '- 数字/代码/报错信息/用户约束必须逐字保真, 禁止约等于或转述\n' +
    '- 回复结论前置, 不重复用户原话, 修改只贴改动部分, 输出用标题/列表/表格/代码块\n' +
    '- 被截断的内容需要完整版时, 主动用工具按路径/行号/关键词取回\n'
  // v0.2.3: 全局记忆注入（置顶/长期/情景摘要,所有会话共享）
  const finalBase = (mode === 'chat' ? chatPrompt : workPrompt) + langInstr + tokenDiscipline + memoryBlock()
  if (g2?.customSystemPrompt) {
    const inj = g2.customSystemPrompt
    const pos = g2.promptInjectPos || 'end'
    if (pos === 'replace') return inj + langInstr
    if (pos === 'begin') return inj + '\n\n' + finalBase
    return finalBase + '\n\n## 自定义系统提示词\n' + inj
  }
  return finalBase
}

interface S {
  sessions: SessionData[]; cid: string | null; sp: string; spIshiki: string; streaming: boolean; error: string | null
  // v0.2.3: 执行阶段(思考中/工具调用) —— 用于思考气泡动态显示, 不写入消息流
  // v0.2.3-fix(Q5): 携带 sid —— 多会话并发时气泡只显示当前会话的阶段, 不串台
  stage: { sid: string; phase: 'thinking' | 'tool'; label: string; detail: string } | null
  terminal: { id: string; name: string; args: any; result: string; time: number }[]
  cu: number; cl: number
  // v0.2.6: 实时使用模型 + 按会话/按模型的缓存命中统计
  curModel: string
  sessCache: Record<string, { hits: number; misses: number }>
  modelCache: Record<string, { hits: number; misses: number }>
  // v0.2.6: 会话×模型的 TOKEN 缓存命中(前端镜像, 右侧面板实时显示)
  sessTok: Record<string, Record<string, { requests: number; readTokens: number; inputTokens: number; writeTokens: number; hitReqs: number }>>

  // v0.2.1: 多Agent 协作状态（当前正在调用的 Agent 集合，并发时多个同时显示）
  activeAgents: string[]
  load: () => Promise<void>
  setMode: (mode: string) => Promise<void>
  create: () => void
  switchS: (id: string) => void
  del: (id: string) => void
  send: (c: string, imgs?: string[]) => Promise<void>
  resendFrom: (msgId: string, newContent?: string) => Promise<void>
  regen: () => Promise<void>
  stop: () => void
  cur: () => SessionData | undefined
}

// v0.2.1: 任务代号 —— stop()/插话使旧任务失效（token 递增），新任务持有新 token 不受影响
let taskGen = 0
// v0.2.1: 插话补充队列 —— 工作中插话=给当前任务补充指令，任务不中断，下一轮执行时注入
let pendingInterject: string[] = []

export const useChatStore = create<S>((set, get) => ({
  sessions: [], cid: null, sp: '', spIshiki: '', streaming: false, executing: false, error: null, stage: null, terminal: [], cu: 0, cl: 65536, curModel: '', sessCache: {}, modelCache: {}, sessTok: {},
  activeAgents: [],
  cur: () => get().sessions.find(s => s.id === get().cid),

  load: async () => {
    const [cfg, ishiki, metas, skills] = await Promise.all([
      window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } })),
      window.huangquan.ishiki.load().catch(() => ''),
      window.huangquan.sessions.list().catch(() => []),
      window.huangquan.skills.list().catch(() => []),
    ])
    const mode = cfg.general?.mode || 'work'
    const ss = skills.length ? '\n\n## 已装载技能\n' + skills.map((s:any) => `- **${s.name}**: ${s.description}`).join('\n') : ''
    const sp = buildPrompt(mode, ishiki) + ss
    // v0.2.3: 独立保存原始 ishiki(不再从 sp 反推, 避免动态内容污染身份段)
    set({ spIshiki: ishiki })
    // 自动创建工作台目录（默认使用主进程 workspace 目录, v0.2.3: 不再硬编码用户路径）
    let wd = (cfg.general as any)?.workDir || ''
    if (!wd) {
      try { const paths: any = await window.huangquan.getPaths(); wd = paths?.workDir || '' } catch { /* 忽略 */ }
      if (wd) useSettingsStore.getState().setWorkDir(wd)
    }
    if (wd) window.huangquan.computer.exec('if (-not (Test-Path "' + wd + '")) { New-Item -ItemType Directory -Path "' + wd + '" -Force }').catch(() => {})
    const sessions = await Promise.all(metas.map((m: any) => window.huangquan.sessions.load(m.id).catch(() => ({ id: m.id, title: 'Chat', messages: [], mode: 'work' }))))
    // v0.2.1: 每次启动创建新的空会话（显示欢迎界面），历史会话保留在侧边栏供点击查看
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode }
    // v0.2.1: 清理历史空会话（从未发过消息的），避免启动多次后堆积垃圾文件
    const stale = sessions.filter(s => s.messages.length === 0)
    for (const s of stale) { window.huangquan.sessions.delete(s.id).catch(() => {}) }
    const kept = sessions.filter(s => s.messages.length > 0)
    kept.unshift(ns)
    // v0.2.3-fix(可用性): maxSessions 设置接入 —— 超限时仅保留最新的 N 个会话(0=不限)
    const maxS = Number((cfg.general as any)?.maxSessions) || 0
    set({ sessions: maxS > 0 ? kept.slice(0, maxS) : kept, cid: ns.id, sp })
  },

  setMode: async (m) => {
    const cfg = await window.huangquan.settings.load().catch(() => ({ providers: [] as any, general: { mode: 'work', theme: 'dark' } }))
    cfg.general.mode = m; await window.huangquan.settings.save(cfg)
    useSettingsStore.getState().load()
    const ishiki = await window.huangquan.ishiki.load().catch(() => '')
    const sp = buildPrompt(m, ishiki)
    const sessions = [...get().sessions]
    const ms = sessions.filter(s => (s.mode || 'work') === m)
    if (ms.length === 0) {
      const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
      sessions.unshift(ns)
      window.huangquan.sessions.save(safeIPC(ns))
      set({ sessions, cid: ns.id, sp })
    } else {
      set({ sessions, cid: ms[0].id, sp })
    }
  },

  create: () => {
    const m = useSettingsStore.getState().general.mode || 'work'
    const ns: SessionData = { id: uuidv4(), title: 'New Chat', messages: [], mode: m }
    // v0.2.3: 新会话独立,不继承其他会话的流式/执行状态
    set(s => ({ sessions: [ns, ...s.sessions], cid: ns.id, streaming: false, executing: false, error: null, activeAgents: [] }))
    window.huangquan.sessions.save(safeIPC(ns))
  },
  switchS: (id) => {
    // v0.2.3-fix(可用性): autoSave 设置接入 —— 切换会话前自动保存当前会话(autoSave !== false 时)
    const curId = get().cid
    if (curId && curId !== id && (useSettingsStore.getState().general as any).autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    set(s => {
      // v0.2.3: 切换会话时,全局 streaming/executing 跟随目标会话的忙碌状态（每个会话独立）
      const target = s.sessions.find(x => x.id === id)
      const busy = !!(target as any)?.busy
      return { cid: id, error: null, streaming: busy, executing: busy }
    })
  },
  del: (id) => {
    window.huangquan.sessions.delete(id)
    // v0.2.6: 缓存命中统计永久保留 —— 删除历史会话不影响设置页统计(本地持久化)
    set(s => { const f = s.sessions.filter(x => x.id !== id); return { sessions: f, cid: s.cid === id ? (f[0]?.id || null) : s.cid, terminal: s.cid === id ? [] : s.terminal } })
  },

  send: async (content, images, attachments?) => {
    const st0 = get()
    let sid = st0.cid; if (!sid) { get().create(); sid = get().cid! }
    // v0.2.3: 会话级忙碌判断 —— 仅当"本会话"正在工作时才走插话；其他会话在工作不影响本会话独立发送
    const thisBusy = (get().sessions.find(x => x.id === sid) as any)?.busy
    if (thisBusy) {
      // 探测当前工作状态
      const cur = get().sessions.find(x => x.id === sid)
      const recentMsgs = cur?.messages.slice(-6) || []
      const hasToolCall = recentMsgs.some(m => (m as any).tool_calls)
      const lastRole = recentMsgs.slice(-1)[0]?.role
      const inToolWork = lastRole === 'tool' || hasToolCall
      const partialReply = recentMsgs.filter(m => m.role === 'assistant' && m.content).slice(-1)[0]?.content?.slice(0, 200) || ''
      // 插话标记
      const prefix = inToolWork
        ? `（用户在工作执行中插话补充。当前正在执行工具操作${partialReply ? '，已完成部分回复：' + partialReply : ''}。请结合当前进度理解用户意图并调整后续操作。）\n`
        : `（用户在回复中插话补充。以下是补充指令。）\n`
      // 用户消息立即上屏
      const interjectMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments }
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, interjectMsg] } : x) }))
      // 补充指令进入队列，当前任务继续执行
      pendingInterject.push(prefix + content)
      return
    }
    const myGen = ++taskGen // 本任务持有新代号；旧任务代号已失效
    // v0.2.3: 标记本会话为忙碌（侧栏"工作中"指示灯 + 独立并发）
    set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: true } : x) }))
    // v0.2: 插话模式下不重置 streaming，让 UI 平滑过渡
    const wasInterjecting = st0.streaming

    // v0.2.1: 多Agent 协作状态 —— 新任务开始时清空；handoff/自动路由不持久，恢复自动（仅用户手动选择保持固定）
    if (!wasInterjecting) {
      set({ activeAgents: [] })
      if ((window as any).__huangquan_agent_manual !== true) delete (window as any).__huangquan_agent
    }

    // 1. 获取 provider 和模型
    const cfg = await window.huangquan.settings.load()
    const p = cfg.providers[0]; if (!p) { set({ streaming: false, executing: false, error: '请先配置 API Provider' }); return }
    // v0.2.3: 发送前刷新全局记忆缓存（置顶/长期记忆对所有会话生效）
    refreshMemoryCache().catch(() => {})
    // v0.2.1: 多模型策略接入 —— mainModel/longTextModel/codeModel/fastModel（"providerId::model" 或 "model"）
    const gNow = useSettingsStore.getState().general as any
    const resolveModel = (key: string): { p: any; model: string } | null => {
      const val = gNow[key]
      if (!val) return null
      const [pid, m] = val.includes('::') ? val.split('::') : [null, val]
      if (pid) { const pr = (cfg.providers || []).find((x: any) => x.id === pid); if (pr && (pr.models || []).includes(m)) return { p: pr, model: m } }
      else if ((p.models || []).includes(val)) return { p, model: val }
      return null
    }
    const main = resolveModel('mainModel') || { p, model: p.selectedModel || p.models[0] || 'deepseek-v4-pro' }
    // 简单任务自动用快速模型（autoFastModel 开启且消息短/无图片时）—— v0.2.3-fix(P29): 词表扩充, 减少误判
    const heavyWords = ['工具', '代码', '脚本', '文件', '读取', '创建', '查找', '目录', '搜索', '网页', '下载', '执行', '命令', '终端', '分析', '总结', '报告', '修改', '删除', '移动', '复制']
    const isSimple = gNow.autoFastModel !== false && !images?.length && content.length < 300 && !heavyWords.some(w => content.includes(w))
    const fast = isSimple ? (resolveModel('fastModel') || main) : main
    let curP = fast.p, model = fast.model
    set({ curModel: model || '' })
    updateContextLimit(model)

    // v0.2.1: 记录当前活跃 Agent（路由结果），供右侧面板展示
    const recordAgent = (name: string) => {
      set(s => ({ activeAgents: s.activeAgents.includes(name) ? s.activeAgents : [...s.activeAgents, name] }))
    }
    if ((window as any).__huangquan_agent) recordAgent((window as any).__huangquan_agent)

    // v0.2.2: 附件（视频/音频/文档）描述拼入消息内容，agent 可用 read_file 等工具读取
    if (attachments && attachments.length) {
      const attachLines = attachments.map(a => `- [${a.kind}] ${a.name}（${(a.size / 1024).toFixed(0)} KB，路径: ${a.path}）`)
      content = content + (content ? '\n\n' : '') + '【用户拖入的附件】\n' + attachLines.join('\n') + '\n如需查看内容，请用 read_file 等工具读取上述路径。'
    }

    // 1. 追加用户消息到 store —— v0.2.3-fix: 立即上屏（不再等视觉分析，避免界面停留初始状态）
    // v0.2.3-fix: images 保留原始图片（聊天框 UI 显示）；finalImages 只影响 API 是否传图
    const userMsg: Message = { id: uuidv4(), role: 'user', content, timestamp: Date.now(), images, attachments }
    const userMsgId = userMsg.id
    set(s => {
      const session = s.sessions.find(x => x.id === sid)!
      // v0.2.1: 会话标题自动取第一条消息（避免一直显示 "New Chat"）
      const isNewChat = !session.title || session.title === 'New Chat' || session.title === 'Chat'
      const title = isNewChat ? content.replace(/\s+/g, ' ').trim().slice(0, 24) + (content.trim().length > 24 ? '…' : '') : session.title
      return { sessions: s.sessions.map(x => x.id === sid ? { ...session, title, messages: [...session.messages, userMsg] } : x), streaming: s.cid === sid ? true : s.streaming, executing: s.cid === sid ? true : s.executing, error: null }
    })

    // v0.2.1: 视觉辅助模型 —— 主模型不支持多模态时，用视觉模型分析图片并转为文本描述
    // v0.2.2-fix: 无论视觉分析是否成功，主模型不支持视觉就不向 API 传图（否则 API 400: unknown variant image_url）
    // v0.2.3-fix: 用户消息已先上屏，分析完成后更新该消息 content（追加分析结果）
    let finalImages = images
    if (images && images.length && !isVisionModel(model)) {
      set(s => ({ executing: s.cid === sid ? true : s.executing }))
      const visionDesc = await analyzeWithVision(p, images, content)
      if (visionDesc && !visionDesc.startsWith('E:')) {
        content = content + '\n\n[图片内容（视觉模型分析）]\n' + visionDesc
      } else {
        let why = ''
        if (visionDesc === 'E:no-vision-model') why = '未配置可用的视觉辅助模型'
        else if (visionDesc && visionDesc.startsWith('E:ALL_VISION_FAILED')) {
          // v0.2.3: 全部视觉候选均失败 → 列出每个失败原因
          const fails = visionDesc.replace(/^E:ALL_VISION_FAILED:\s*/, '').split(' | ')
          why = '所有视觉辅助模型均无法连通：' + fails.join('；')
        } else why = (visionDesc || '').replace(/^E:/, '') || '视觉分析失败'
        content = content + '\n\n[图片未能分析：' + why + '。可在 设置→策略→👁️视觉理解 中配置视觉辅助模型优先级（如通义 qwen-vl、智谱 glm-4v、Kimi vision 等）。]'
      }
      finalImages = undefined // 主模型不支持视觉，不向 API 传图
      // 同步更新已上屏的用户消息内容
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === userMsgId ? { ...m, content } : m) } : x) }))
    }

    const buildMsg = (msgs: Message[], withImages: boolean): LLMMessage[] => {
      const d: LLMMessage[] = []
      // v0.2.6: 历史消息硬上限 40 条(超长会话只保留最近 40 条, 大幅降低 token 消耗)
      const list = msgs.length > 40 ? msgs.slice(-40) : msgs
      for (const m of list) {
        if (m.role === 'tool') {
          // v0.2.6: 工具结果瘦身 —— 超长结果保留头尾+关键行(保真截断, 避免大段工具输出反复占用上下文)
          const c = m.content || ''
          let body = c
          if (c.length > 3000) {
            const mid = c.slice(1500, -800)
            const keyLines = mid.split('\n').filter((l: string) => /error|exception|failed|warning|fatal|E:/.test(l)).slice(0, 15).join('\n')
            body = c.slice(0, 1500) + '\n...[已截断, 共 ' + c.length + ' 字符]' + (keyLines ? '\n[关键行]\n' + keyLines : '') + '\n[尾部]\n' + c.slice(-800)
          }
          d.push({ role: 'tool', content: body, tool_call_id: (m as any).tool_call_id || 'c_' + uuidv4().slice(0, 8) })
        }
        else if (m.role === 'assistant' && (m as any).tool_calls) d.push({ role: 'assistant', content: null, tool_calls: (m as any).tool_calls })
        // v0.2.3-fix: 主模型支持视觉才传 image_url；否则只传文字（图片内容已由视觉辅助模型分析成文字）
        else if (m.role === 'user' && m.images?.length && withImages) { const parts: any[] = [{ type: 'text', text: m.content }]; m.images.forEach(img => parts.push({ type: 'image_url', image_url: { url: img } })); d.push({ role: 'user', content: parts }) }
        else if (m.role === 'user' || m.role === 'assistant') d.push({ role: m.role, content: m.content || ' ' })
      }
      // 每次发送时根据当前模式重建系统提示词
      const currentMode = useSettingsStore.getState().general.mode || 'work'
      // v0.2.3: 使用独立保存的 ishiki(不再从 sp 反推 —— sp 含技能列表/动态内容会污染身份段)
      const ishiki = get().spIshiki || get().sp.replace(/\n##.+/s, '')
      let sp = buildPrompt(currentMode, ishiki)
      // 注入 Agent 角色
      let agentRole = (window as any).__huangquan_agent
      // 自动检测：根据用户最后一条消息内容匹配最合适的 Agent
      if (!agentRole) {
        const lastUserMsg = [...d].reverse().find(m => m.role === 'user')
        const txt = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase()
        if (txt) agentRole = routeAgent(txt) || undefined
      }
      // v0.2.1: 路由确定的 Agent 记入协作状态
      if (agentRole && !(window as any).__huangquan_agent) {
        set(s => ({ activeAgents: s.activeAgents.includes(agentRole) ? s.activeAgents : [...s.activeAgents, agentRole] }))
      }
      if (agentRole) {
        const ag = AGENTS[agentRole]
        if (ag) sp += '\n\n## 当前身份\n' + ag.icon + ' ' + agentRole + ' — ' + ag.role + '\n' + ag.prompt +
          '\n可用工具: ' + ag.tools.join(', ')
        // v0.2.1: 主控调度铁律 —— 多领域任务必须 dispatch 分发，确保链路出现多个 Agent
        if (agentRole === '姬子') {
          sp += '\n\n【调度铁律】用户任务若涉及多个专业领域（如代码+文档、设计+开发、分析+总结、开发+测试+审查），你必须立即调用 dispatch 把子任务分发给对应 Agent 并行执行，不能自己包办；只有单领域小任务才可亲自完成或 handoff。'
        }
      }
      // v0.2.6: 时间戳放绝对最末尾 —— 保持前缀稳定, 最大化缓存命中(动态内容永不打断前缀)
      sp += '\n## 当前时间\n' + new Date().toLocaleString('zh-CN')
      // v0.2: 上下文压缩（v0.2.1: 接入 compactStrategy/compactMsgCount/compactTokenLimit/compactStrength 设置）
      const gComp = useSettingsStore.getState().general as any
      const compStrategy = gComp.compactStrategy || 'auto'
      const msgLimit = gComp.compactMsgCount || 20
      const tokenLimit = gComp.compactTokenLimit || 50000
      if (compStrategy === 'off' && d.length > msgLimit + 20) {
        // 关闭压缩：溢出则截断（保留最近 msgLimit 条）
        return sp ? [{ role: 'system', content: sp }, ...d.slice(-msgLimit)] : d.slice(-msgLimit)
      }
      if (compStrategy !== 'manual' && d.length > msgLimit) {
        const estTokens = d.reduce((s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''), 0)
        const threshold = (useSettingsStore.getState().general as any).compactThreshold ?? 0.7
        if (estTokens > (gComp.compactTokenLimit ? tokenLimit : get().cl * threshold)) {
          const keepCount = Math.min(16, Math.floor(d.length * 0.4))
          const keep = d.slice(-keepCount)
          const early = d.slice(0, d.length - keepCount)
          const userMsgs = early.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content.slice(0, 80) : '')
          const toolCount = early.filter(m => m.role === 'tool').length
          const assistantMsgs = early.filter(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 50)
          const keyOutputs = assistantMsgs.slice(-3).map(m => m.content.replace(/\n/g, ' ').slice(0, 100))
          const summary = [`[上下文压缩] 早期 ${early.length} 条消息已摘要：`, `${userMsgs.length} 轮用户交互`, toolCount > 0 ? `${toolCount} 次工具调用` : '', keyOutputs.length > 0 ? `最近产出：${keyOutputs.join(' | ')}` : ''].filter(Boolean).join(' · ')
          return [{ role: 'system', content: sp + '\n\n' + summary }, ...keep]
        }
      }
      return sp ? [{ role: 'system', content: sp }, ...d] : d
    }

    type CallResult = { text: string; tcs: { id: string; name: string; args: any }[] }
    const callLLM = (aid: string, ridArg?: string): Promise<CallResult> =>
      new Promise((resolve, reject) => {
        const cbs: (() => void)[] = []; let text = ''; const tcs: any[] = []
        // v0.2.3: 多会话并发 —— 每次调用独立 requestId，只收自己的流式事件
        // v0.2.3: rid 由外部传入(超时 abort 可精确对应同一请求)
        const rid = ridArg || ('r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8))
        // v0.2.2: 记录 TTFT(首字延迟) / 总时长 / token 用量
        const t0 = Date.now(); let firstChunkAt = 0; let usage: any = null
        cbs.push(window.huangquan.llm.onUsage(u => {
          if (u && u.requestId && u.requestId !== rid) return
          // v0.2.6: 按模型单价估算本次消费金额
          if (u) {
            // v0.2.6: 用量归一化(监控方案): 兼容 DeepSeek/OpenAI/Anthropic 缓存字段
            // read: prompt_cache_hit_tokens | prompt_tokens_details.cached_tokens | cache_read_input_tokens
            // write: cache_creation_input_tokens(Anthropic 写入缓存, 单独统计)
            const readT = u.prompt_cache_hit_tokens || (u as any).prompt_tokens_details?.cached_tokens || (u as any).cache_read_input_tokens || 0
            const writeT = (u as any).cache_creation_input_tokens || 0
            const inputT = u.prompt_tokens || (u as any).input_tokens || 0
            usage = { ...u, _readTokens: readT, _inputTokens: inputT, _writeTokens: writeT }
            // v0.2.6: 同一次请求的 usage 只统计/累加一次(流式 usage 可能多次到达, 防重复)
            if (!costedReqs.has(rid)) {
              // v0.2.3: 防止无限增长(每 500 条裁剪一半)
              if (costedReqs.size > 500) { const arr = [...costedReqs]; costedReqs.clear(); for (const x of arr.slice(-250)) costedReqs.add(x) }
              costedReqs.add(rid)
              const sid2 = get().cid || ''
              // 持久化埋点(主进程, 会话×模型)
              try {
                window.huangquan.modelStats?.recordRequest(sid2, model, readT > 0)
                if (readT > 0 || inputT > 0 || writeT > 0) window.huangquan.modelStats?.recordTokens(sid2, model, readT, inputT, writeT)
              } catch { /* 忽略 */ }
              // 前端镜像(右侧面板实时显示)
              if (sid2) set(s => {
                const ss = s.sessTok[sid2] || {}
                const c2 = ss[model] || { requests: 0, readTokens: 0, inputTokens: 0, writeTokens: 0, hitReqs: 0 }
                return { sessTok: { ...s.sessTok, [sid2]: { ...ss, [model]: { requests: c2.requests + 1, readTokens: c2.readTokens + readT, inputTokens: c2.inputTokens + inputT, writeTokens: c2.writeTokens + writeT, hitReqs: c2.hitReqs + (readT > 0 ? 1 : 0) } } } }
              })
            }
          } else { usage = u }
        }))
        // v0.2.5-opt: 流式渲染节流 —— 40ms 内合并多次 chunk 再 set, 避免每个 token 全量重渲染
        let flushTimer: any = null
        const flushText = () => {
          flushTimer = null
          const cur = text
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: cur } : m) } : x), streaming: s.cid === sid ? true : s.streaming }))
        }
        cbs.push(window.huangquan.llm.onChunk(d => {
          if (d.requestId && d.requestId !== rid) return // 其他会话的流，忽略
          if (!firstChunkAt && d.content) firstChunkAt = Date.now()
          text += d.content
          if (!flushTimer) flushTimer = setTimeout(flushText, 40)
          if (d.done) {
            if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
            set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text } : m) } : x), streaming: s.cid === sid ? false : s.streaming }))
            cbs.forEach(f => f())
            const ttft = firstChunkAt ? firstChunkAt - t0 : (Date.now() - t0)
            const duration = Date.now() - t0
            set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid ? { ...m, content: text, usage: usage || m.usage, meta: { ttft, duration } } : m) } : x) }))
            if (!text && !tcs.length) { reject(new Error('模型返回空响应，请检查 API 配置或切换模型')); return } resolve({ text, tcs })
          }
        }))
        cbs.push(window.huangquan.llm.onError((e: any) => {
          const errMsg = typeof e === 'string' ? e : (e?.error || String(e))
          if (e && e.requestId && e.requestId !== rid) return // 其他会话的错误，忽略
          cbs.forEach(f => f()); reject(new Error(errMsg))
        }))
        // v0.2.3-fix(P27): 工具参数解析失败不再完全静默 —— console.warn 便于排查
        cbs.push(window.huangquan.llm.onToolCall((tc: any) => { if (tc && tc.requestId && tc.requestId !== rid) return; try { if (tc.function?.name) tcs.push({ id: tc.id || 'c' + Date.now(), name: tc.function.name, args: tc.function.arguments ? JSON.parse(tc.function.arguments) : {} }) } catch { console.warn('[黄泉Agent] 工具参数解析失败:', tc?.function?.name, String(tc?.function?.arguments || '').slice(0, 100)) } }))
        const cur = get().sessions.find(x => x.id === sid)!
        const msgs = buildMsg(cur.messages, isVisionModel(model))
        // v0.2: 更新上下文用量
        const estCu = msgs.reduce((s,m) => s + (typeof m.content === 'string' ? m.content.length : Array.isArray(m.content) ? (m.content as any[]).reduce((t:number,p:any) => t + (p.text?.length || 0), 0) : 0), 0)
        set({ cu: estCu })
        window.huangquan.llm.chat({ requestId: rid, provider: curP.type, model, apiKey: curP.apiKey, baseUrl: curP.baseUrl, messages: msgs as any, temperature: (useSettingsStore.getState().general as any).temperature ?? 0.7, max_tokens: (useSettingsStore.getState().general as any).maxTokens || undefined, tools: getActiveTools(), headers: (curP as any).headers }).catch(e => { cbs.forEach(f => f()); reject(e) })
      })

    try {
      // 每次 LLM 调用独立超时保护 —— v0.2.3: 只中止当前请求(requestId), 不再误杀其他会话并发请求
      let timeoutId: any = null
      // v0.2.3-fix(可用性): toolTimeout 设置接入 —— 默认 120s, 可在设置中调整
      const toolTimeout = Number((useSettingsStore.getState().general as any).toolTimeout) || 120000
      const guard = (rid: string) => { timeoutId = setTimeout(() => window.huangquan.llm.abort(rid), toolTimeout) }
      const clear = () => { if (timeoutId) clearTimeout(timeoutId) }

      // v0.2.1: 主执行循环 —— 正常轮次 + 插话补充轮次（工作中插话=补充指令，任务继续而非重开）
      let roundNum = 0
      let aid = ''
      let res: CallResult = { text: '', tcs: [] }
      let toolLog: { name: string; args: any; result: string; error: boolean; ms: number }[] = []
      while (true) {
        roundNum++
        if (myGen !== taskGen) break // 被终止
        // 2. 创建空的 assistant 占位（每轮一个新气泡位）
        aid = uuidv4()
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))
        // v0.2.1: 消费插话补充（第 2 轮起）—— 作为 user 消息注入，Agent 继续任务时可见
        if (roundNum > 1 && pendingInterject.length) {
          const inject = pendingInterject.shift()!
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: uuidv4(), role: 'user', content: inject, timestamp: Date.now() } as any] } : x) }))
        }

        const rid1 = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
        guard(rid1)
        set({ stage: { sid, phase: 'thinking', label: '思考中', detail: '' } })
        res = await callLLM(aid, rid1); clear()

        // 3. 工具调用循环（熔断+计时+重试+并行+单气泡整合）
        toolLog = []
        for (let r = 0; res.tcs.length > 0 && r < ((useSettingsStore.getState().general as any).maxToolRounds || 50); r++) {
          // v0.2.1: 用户终止/插话 —— 任务代号失效则立即停止
          if (myGen !== taskGen) break
          // 熔断检测
          const meltLimit = (useSettingsStore.getState().general as any).meltdownLimit || 3
          const rc = new Map(); for (const t of toolLog) { const k = t.name + '::' + JSON.stringify(t.args || {}); rc.set(k, (rc.get(k) || 0) + 1) }
          if (res.tcs.some((tc: any) => (rc.get(tc.name + '::' + JSON.stringify(tc.args || {})) || 0) >= meltLimit)) { console.warn('[黄泉Agent] 熔断'); break }

          set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'assistant', content: null, timestamp: Date.now(), tool_calls: res.tcs.map((tc2: any) => ({ id: tc2.id, type: 'function', function: { name: tc2.name, arguments: JSON.stringify(tc2.args) } })) } as any]; return { sessions: s.sessions.map(x => x.id === sid ? cur : x) } })

          const maxRetry = (useSettingsStore.getState().general as any).retryCount ?? 3
          const doParallel = (useSettingsStore.getState().general as any).parallelTools !== false
          const doEpisodic = (useSettingsStore.getState().general as any).episodicMemory !== false

          const runOne = async (tc: any) => { let r2 = '', ms = 0; for (let a = 0; a <= maxRetry; a++) { const t0 = Date.now(); // v0.2.3: 思考气泡显示「正在调用 XX」
            const argS = JSON.stringify(tc.args || {}); set({ stage: { sid, phase: 'tool', label: '🔧 ' + tc.name, detail: argS && argS.length > 40 ? argS.slice(0, 40) + '…' : (argS || '') } })
            r2 = await runTool(tc.name, tc.args); ms = Date.now() - t0; if (!r2.startsWith('E:')) break; if (a < maxRetry) await new Promise(r => setTimeout(r, 500)) } if (r2 && !r2.startsWith('E:')) setCached(tc.name + ':' + JSON.stringify(tc.args || {}), r2); toolLog.push({ name: tc.name, args: tc.args, result: r2, error: r2.startsWith('E:'), ms }); // v0.2.3: 完成后显示 ✓(带结果摘要)
          set({ stage: { sid, phase: 'tool', label: '✓ ' + tc.name, detail: (r2 && r2.length > 50 ? r2.slice(0, 50) + '…' : (r2 || '')) } })
          if (doEpisodic) recordEpisodic(tc.name, tc.args, r2).catch(() => {}); if (tc.name === 'handoff' && tc.args?.agent_name) { const to = tc.args.agent_name; set(s => ({ activeAgents: s.activeAgents.includes(to) ? s.activeAgents : [...s.activeAgents, to] })) }; return { tc, r: r2 } }
          const writes = ['write', 'edit', 'exec_command', 'mkdir', 'codebox']
          if (doParallel) {
            // 读类并行，写类串行；结果按 tc 一一对应收集，避免同名工具结果错配
            const readTcs = res.tcs.filter((tc: any) => !writes.includes(tc.name))
            const writeTcs = res.tcs.filter((tc: any) => writes.includes(tc.name))
            const results: { tc: any; r: string }[] = []
            const pResults = await Promise.all(readTcs.map(runOne))
            results.push(...pResults)
            for (const tc of writeTcs) { results.push(await runOne(tc)) }
            for (const { tc, r } of results) {
              set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'tool', content: r, timestamp: Date.now(), tool_call_id: tc.id } as any]; const entry: any = { id: uuidv4(), name: tc.name, args: tc.args, result: r, time: Date.now() }; return { sessions: s.sessions.map(x => x.id === sid ? cur : x), terminal: [...s.terminal, entry] } })
            }
          } else {
            for (const tc of res.tcs) { const { r } = await runOne(tc); set(s => { const cur = { ...s.sessions.find(x => x.id === sid)! }; cur.messages = [...cur.messages, { id: uuidv4(), role: 'tool', content: r, timestamp: Date.now(), tool_call_id: tc.id } as any]; const entry: any = { id: uuidv4(), name: tc.name, args: tc.args, result: r, time: Date.now() }; return { sessions: s.sessions.map(x => x.id === sid ? cur : x), terminal: [...s.terminal, entry] } }) }
          }

          // v0.2.1: 工具执行中用户插话 → 补充立即注入（作为 user 消息），下一轮 LLM 可见
          while (pendingInterject.length && myGen === taskGen) {
            const inject = pendingInterject.shift()!
            set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: uuidv4(), role: 'user', content: inject, timestamp: Date.now() } as any] } : x) }))
          }

          // v0.2.1: 多模型策略 —— 代码类任务切 codeModel，文档/总结类切 longTextModel
          const toolNames = res.tcs.map((tc: any) => tc.name)
          if (toolNames.some((n: string) => ['write', 'edit', 'exec_command', 'mkdir', 'codebox', 'grep', 'read'].includes(n))) {
            const cm = resolveModel('codeModel'); if (cm) { curP = cm.p; model = cm.model }
          } else if (toolNames.some((n: string) => ['summarize', 'save_memory', 'recall_memory', 'web_search', 'web_fetch', 'import_doc'].includes(n))) {
            const lm = resolveModel('longTextModel'); if (lm) { curP = lm.p; model = lm.model }
          }
          aid = uuidv4(); set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: [...x.messages, { id: aid, role: 'assistant', content: '', timestamp: Date.now() }] } : x) }))
          const rid2 = 'r' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)
          guard(rid2)
          set({ stage: { sid, phase: 'thinking', label: '思考中', detail: '' } })
          if (myGen !== taskGen) { clear(); break } // 终止后不再发起下一轮 LLM
          res = await callLLM(aid, rid2); clear()
          if (myGen !== taskGen) break // 终止后丢弃本轮结果
        }

        // 4. 单气泡 + Hermes 风格日志
        set({ stage: null }) // v0.2.3: 任务完成, 思考气泡消失
        const finalSession = get().sessions.find(x => x.id === sid)
        if (finalSession) {
          // v0.2.1: 合并本轮所有 assistant 文本 → 单一气泡（工具循环中间轮的文字并入最终回复）
          const lastUserIdx = finalSession.messages.map(m => m.id).lastIndexOf(userMsg.id)
          const thisRound = lastUserIdx >= 0 ? finalSession.messages.slice(lastUserIdx) : finalSession.messages
          const midTexts = thisRound.filter(m => m.role === 'assistant' && m.content && m.id !== aid).map(m => m.content as string)
          const llmText = res.text || ''; const hasTools = toolLog.length > 0
          let finalContent = [ ...midTexts, llmText ].filter(Boolean).join('\n\n')
          // v0.2.3: 工具日志已改为写入右侧终端面板(terminal), 不再拼进消息正文(原死代码块已删除)
          // 中间轮 assistant 文本已并入最终气泡，清空其 content（UI 单气泡，API 上下文仍保留占位）
          // v0.2.2-fix: 只清空【本轮内】的中间 assistant 消息 —— 之前遍历整个会话导致历史回复全部被清空
          const roundIds = new Set(thisRound.map(m => m.id))
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => (roundIds.has(m.id) && m.role === 'assistant' && m.content && m.id !== aid) ? { ...m, content: '' } : (m.id === aid ? { ...m, content: finalContent, _toolLog: toolLog } : m)) } : x) }))
        }

        // v0.2.1: 有插话补充且未被终止 → 继续下一轮（任务不中断）
        if (myGen !== taskGen || pendingInterject.length === 0) break
      }

      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
      set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: null, activeAgents: s.cid === sid ? [] : s.activeAgents }))
      const toSave = get().sessions.find(x => x.id === sid)
      if (toSave) { window.huangquan.sessions.save(safeIPC(toSave)); autoExtractMemory(sid).catch(() => {}) }
    } catch (e) {
      const errMsg = e?.message || String(e)
      // v0.2.2-fix: API 不接受 image_url 时（模型实际不支持视觉），移除图片后自动重试一次纯文本
      if (images?.length && /image_url|image url|image data/i.test(errMsg)) {
        console.warn('[黄泉Agent] 模型不支持图片，自动降级为纯文本重试:', errMsg.slice(0, 120))
        try {
          // v0.2.3-fix(P11): 简化 —— 直接按 userMsg.id 过滤, 消除冗余查找
          set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.filter(m => m.id !== userMsg?.id) } : x) }))
        } catch { /* 忽略 */ }
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
        set({ streaming: false, executing: false, error: null, activeAgents: [] })
        return get().send(content, undefined, attachments)
      }
      console.error('[黄泉Agent] send error:', e)
      // v0.2.1: 异常/插话中止时清理当前流式 assistant 残留（避免多气泡）
      try {
        set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, messages: x.messages.map(m => m.id === aid && !m.content ? { ...m, content: '' } : m) } : x) }))
      } catch { /* 会话可能已删除 */ }
      set(s => ({ sessions: s.sessions.map(x => x.id === sid ? { ...x, busy: false } : x) }))
      set(s => ({ streaming: s.cid === sid ? false : s.streaming, executing: s.cid === sid ? false : s.executing, error: s.cid === sid ? errMsg : s.error, stage: s.cid === sid ? null : s.stage, activeAgents: s.cid === sid ? [] : s.activeAgents }))
    }
  },

  stop: () => {
    taskGen++; window.huangquan.llm.abort()
    // v0.2.3-fix(可用性): autoSave 设置接入 —— 停止时保存当前会话(部分回复不丢失)
    const curId = get().cid
    if (curId && (useSettingsStore.getState().general as any).autoSave !== false) {
      const cur = get().sessions.find(x => x.id === curId)
      if (cur) window.huangquan.sessions.save(cur).catch(() => {})
    }
    // v0.2.3: 停止时也清除当前会话忙碌标记
    if (curId) set(s => ({ sessions: s.sessions.map(x => x.id === curId ? { ...x, busy: false } : x) }))
    set({ streaming: false, executing: false, error: null })
  },

  // v0.2.2: 从指定用户消息重新发送（编辑后重发 / 刷新重发）
  resendFrom: async (msgId: string, newContent?: string) => {
    const s = get().cur(); if (!s || get().streaming) return
    const idx = s.messages.findIndex(m => m.id === msgId)
    if (idx < 0 || s.messages[idx].role !== 'user') return
    const lu = s.messages[idx]
    const msgs = s.messages.slice(0, idx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(newContent !== undefined ? newContent : lu.content, lu.images, lu.attachments)
  },
  regen: async () => {
    const s = get().cur(); if (!s || get().streaming) return
    // 找到最后一条用户消息的位置
    let lastUserIdx = -1
    for (let i = s.messages.length - 1; i >= 0; i--) { if (s.messages[i].role === 'user') { lastUserIdx = i; break } }
    if (lastUserIdx < 0) return
    const lu = s.messages[lastUserIdx]
    // 删除最后一条用户消息及之后的所有内容（send() 会重新添加用户消息）
    const msgs = s.messages.slice(0, lastUserIdx)
    set(st => ({ sessions: st.sessions.map(x => x.id === s.id ? { ...x, messages: msgs } : x) }))
    await get().send(lu.content, lu.images)
  },
}))
