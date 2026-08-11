// scripts/eval/benchmark.ts — 黄泉Agent 评估基准(v0.3.9)
// unit: 纯函数回归(无需 API Key, 发布门禁必跑)
// live: 真实模型工具选择(BFCL-lite, 可选, 需要应用内已配置供应商)
// 用法: npx tsx scripts/eval/benchmark.ts unit [settings.json] | live [settings.json]
import * as fs from 'fs'
import { join } from 'path'
import * as os from 'os'
import { memoryBlockText, memoryPathFor, recallFromMemory, type EngineMemory } from '../../electron/engine/memory'
import { applyCompact, pickMicroFoldCandidates } from '../../electron/engine/compact'
import { routeAgent } from '../../electron/engine/context'
import { dedupePlanSteps } from '../../electron/engine/plan-core'
import { parseSkillDescription, resolveSkillFile, safeSkillName } from '../../electron/engine/skill-files'
import { parseSubResult } from '../../electron/engine/sub-result'
import { TOOLS } from '../../electron/engine/tool-specs'
import { streamChat } from '../../electron/engine/llm-core'
import type { EngineMessage } from '../../electron/engine/types'

interface EvalCase { id: string; name: string; pass: boolean; detail?: string }
const cases: EvalCase[] = []
function check(id: string, name: string, ok: boolean, detail?: string): void {
  cases.push({ id, name, pass: !!ok, detail })
}

function mem(over: Partial<EngineMemory> = {}): EngineMemory {
  return { facts: [], summaries: [], pinnedFacts: [], lessons: [], ...over }
}

function msg(id: string, role: EngineMessage['role'], content: string | null, tool = false): EngineMessage {
  return { id, role, content, timestamp: 1, tool_calls: tool ? [{ id: 'c', type: 'function', function: { name: 'ls', arguments: '{}' } }] : undefined }
}

function runUnit(): void {
  // 1. 意图路由
  check('route-code', '代码任务路由到螺丝咕姆', routeAgent('帮我写个 Python 脚本处理数据', {}) === '螺丝咕姆')
  check('route-doc', '文档任务路由到三月七', routeAgent('把今天的会议整理成一份总结报告', {}) === '三月七')
  check('route-close', '协作关闭时返回 null', routeAgent('帮我写代码', { collabMode: '关闭' }) === null)

  // 2. 记忆注入: 无乱码 + 相关度
  const m1 = mem({ pinnedFacts: ['用户偏好 PowerShell'], facts: ['项目使用 Electron', '用户喜欢咖啡'], summaries: [{ content: '本周完成上下文重构', timestamp: 1 }] })
  const block = memoryBlockText(m1, 'PowerShell 怎么用')
  check('memory-mojibake', '记忆块无乱码占位符', !block.includes('??'), block.slice(0, 80))
  check('memory-headers', '记忆块含容量头与分区标题', block.includes('【记忆容量】') && block.includes('## 置顶事实') && block.includes('## 事实'))
  const m2 = mem({ facts: ['Python 数据分析', '用户喜欢咖啡', 'Python 部署脚本', '周末爬山'] })
  const rel = memoryBlockText(m2, 'Python 部署')
  check('memory-relevance', '事实按相关度选取', rel.includes('Python 部署脚本') && !rel.includes('爬山') && !rel.includes('咖啡'), rel.slice(0, 120))

  // 3. 记忆检索与私有命名空间
  const recall = recallFromMemory(mem({ facts: ['Python 项目在 D:/py'] }), 'python', [])
  check('memory-recall', 'recall_memory 命中关键词事实', recall.includes('Python 项目在 D:/py'))
  check('memory-scope', 'private 记忆独立于全局文件', memoryPathFor('C:/data/memory.json', 'private', '银狼') !== 'C:/data/memory.json')

  // 4. 上下文压缩: 保留最近轮次 + 批量微压缩
  const history: EngineMessage[] = []
  for (let i = 0; i < 10; i++) history.push(msg('u' + i, 'user', '问题' + i), msg('a' + i, 'assistant', '回答' + i))
  const compacted = applyCompact(history, '历史摘要', 2)
  check('compact-recent', '窗口压缩保留最近轮次', compacted.length < history.length && compacted[0].content?.includes('历史摘要') && compacted.some(x => x.id === 'u9'))
  const fold = pickMicroFoldCandidates(history, 3)
  check('micro-fold', '微压缩批量折叠 3 组问答', !!fold && fold.pairs.length === 3 && fold.end === 6)

  // 5. 计划去重
  const dedup = dedupePlanSteps([
    { id: 'a', label: '读取', tool: 'read', status: 'pending' },
    { id: 'b', label: '读取', tool: 'read', status: 'pending' },
    { id: 'a', label: '读取', tool: 'read', status: 'done' },
  ])
  check('plan-dedupe', 'update_plan 重复步骤去重', dedup.length === 1 && dedup[0].id === 'a')

  // 6. 技能解析与路径安全
  check('skill-description', 'SKILL.md frontmatter 解析', parseSkillDescription('---\ndescription: 测试技能\n---\n内容', 'fallback') === '测试技能')
  check('skill-name', '技能名净化', safeSkillName('../x') === 'x' && safeSkillName('') === '')
  const tmp = fs.mkdtempSync(join(os.tmpdir(), 'hq-eval-'))
  check('skill-traversal', '技能文件路径防越权', resolveSkillFile([tmp], 'a', '../evil.md') === null)

  // 7. 子代理结构化结果
  const sub = parseSubResult('```json\n{"goal":"写报告","status":"done","outputs":["D:/out.md"],"open":[]}\n```')
  check('sub-result', '子代理结果结构化解析', sub.goal === '写报告' && sub.outputs?.[0] === 'D:/out.md')
}

async function pickTool(p: { type: string; apiKey?: string; baseUrl?: string; selectedModel?: string; models?: string[] }, g: Record<string, unknown>, tools: typeof TOOLS, prompt: string): Promise<{ tool: string | null; err?: string; finish?: string; text?: string }> {
  const tcs: { name: string }[] = []
  let err: unknown = null
  let finish: string | undefined
  let text = ''
  await streamChat(fetch, {
    provider: p.type,
    model: p.selectedModel || (p.models && p.models[0]) || '',
    apiKey: p.apiKey,
    baseUrl: p.baseUrl,
    messages: [
      { role: 'system', content: '你是工具调用测试器。只能通过工具完成用户请求，只调用最合适的一个工具，不输出任何文字。' },
      { role: 'user', content: prompt },
    ],
    tools: tools as never,
    thinkLevel: String(g.thinkLevel || 'off'),
    temperature: 0.2,
    max_tokens: 1024,
  }, {
    onChunk: d => { if (d.content) text += d.content; if (d.finishReason) finish = d.finishReason },
    onToolCall: tc => { if (tc?.function?.name) tcs.push({ name: tc.function.name }) },
    onUsage: () => {},
    onError: e => { err = e },
  })
  return { tool: tcs[0]?.name || null, err: err ? (typeof err === 'string' ? err : err instanceof Error ? err.message : JSON.stringify(err)) : undefined, finish, text: text.slice(0, 120) }
}

async function runLive(settingsPath: string): Promise<void> {
  const abs = settingsPath || join(process.env.APPDATA || '', 'huangquan-agent', 'settings.json')
  let raw: { providers?: { type: string; apiKey?: string; baseUrl?: string; selectedModel?: string; models?: string[] }[]; general?: Record<string, unknown> }
  try {
    raw = JSON.parse(fs.readFileSync(abs, 'utf-8'))
  } catch (e) {
    check('live-settings', '读取设置文件', false, abs + ' 读取失败: ' + (e instanceof Error ? e.message : String(e)))
    return
  }
  const providers = (raw.providers || []).filter(p => p.apiKey && p.baseUrl)
  const p = providers[0]
  if (!p) {
    check('live-provider', '真实模型工具选择: 未配置供应商', false, '请在应用 设置→模型 中配置 API 后再运行 eval:live')
    return
  }
  const tools = TOOLS.filter(t => ['read', 'ls', 'write', 'grep', 'exec_command', 'web_search', 'find'].includes(t.function.name))
  const tasks = [
    { id: 'live-ls', prompt: '查看 D:/temp 目录里有哪些文件', expect: 'ls' },
    { id: 'live-read', prompt: '读取 D:/temp/readme.md 的完整内容', expect: 'read' },
    { id: 'live-write', prompt: '把 hello world 保存到 D:/temp/out.txt', expect: 'write' },
    { id: 'live-grep', prompt: '在 D:/temp 里搜索包含 bug 的行', expect: 'grep' },
  ]
  for (const t of tasks) {
    try {
      const got = await pickTool(p, raw.general || {}, tools, t.prompt)
      check(t.id, '工具选择期望 ' + t.expect, got.tool === t.expect, '期望 ' + t.expect + '，实际 ' + (got.tool || '(无工具调用)') + (got.err ? ' | 错误: ' + got.err : '') + (got.finish ? ' | finish: ' + got.finish : '') + (got.text ? ' | 文本: ' + got.text : ''))
    } catch (e) { check(t.id, '工具选择期望 ' + t.expect, false, e instanceof Error ? e.message : String(e)) }
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'unit'
  if (mode === 'live') await runLive(process.argv[3] || '')
  else runUnit()
  const passed = cases.filter(c => c.pass).length
  const failed = cases.length - passed
  const report = { at: new Date().toISOString(), mode, total: cases.length, passed, failed, cases }
  try {
    // 自省整改: 评估历史只保留最近 200 条, 避免无限累积
    const histPath = join(process.cwd(), 'scripts/eval/eval-history.jsonl')
    const lines = fs.existsSync(histPath) ? fs.readFileSync(histPath, 'utf-8').split('\n').filter(Boolean) : []
    lines.push(JSON.stringify(report))
    fs.writeFileSync(histPath, lines.slice(-200).join('\n') + '\n', 'utf-8')
  } catch { /* 历史记录失败不影响评估 */ }
  console.log('\n评估结果[' + mode + ']: ' + passed + '/' + cases.length + ' 通过')
  for (const c of cases) console.log((c.pass ? '  [OK]' : '  [X]') + ' ' + c.id + ' ' + c.name + (c.detail && !c.pass ? ' — ' + c.detail : ''))
  if (mode !== 'live' && failed > 0) process.exitCode = 1
}

void main()
