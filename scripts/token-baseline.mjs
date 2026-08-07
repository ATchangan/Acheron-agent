// v0.3.4 T4 / v0.3.2 T3: token 基准测试 —— 9 任务基准集(与 docs/baseline-intelligence-report.md 同一套)
// 用法: node scripts/token-baseline.mjs
// v0.3.5 T3: 对比版本更新为 0.3.5, 增加门禁检查表与失败归因记录区
// 说明: 需要在真实模型上逐任务运行并填入数据(本脚本生成报告骨架, 防止任务集漂移)
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ratioArg = process.argv.find((x, i) => process.argv[i - 1] === '--ratio')
const ratio = ratioArg || '0.70'

// 任务集固定(跨版本可比): 闲聊×3 / 中等×3 / 复杂×3 —— 禁止修改, 新增任务只能追加
const TASKS = [
  { id: 'chat-1', type: '闲聊', desc: '介绍你自己(人设向)' },
  { id: 'chat-2', type: '闲聊', desc: '简单情绪回应/安慰一句' },
  { id: 'chat-3', type: '闲聊', desc: '推荐 3 本书并说明理由' },
  { id: 'mid-1', type: '中等', desc: '读取某文件并总结要点' },
  { id: 'mid-2', type: '中等', desc: '网络搜索某主题并整理' },
  { id: 'mid-3', type: '中等', desc: '把一段文本翻译成英文' },
  { id: 'hard-1', type: '复杂', desc: '多文件开发(建项目结构+写代码+说明)' },
  { id: 'hard-2', type: '复杂', desc: '写脚本并执行验证' },
  { id: 'hard-3', type: '复杂', desc: '文档处理(导入/分析/导出报告)' },
]

// v0.3.5 T3: 对比维度 —— 0.3.0(基线) vs 0.3.5(本版), 同任务集逐项对照
const rows = TASKS.map(t =>
  `| ${t.id} | ${t.type} | ${t.desc} | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 | 待填 |`
).join('\n')

const report = `# Token 基准报告（v0.3.5 全系列收尾对比）

> 生成: ${new Date().toISOString()} · 任务集与 baseline-intelligence-report.md 一致(禁止修改)
> 每档跑完整 9 任务后填写; 完成度人工勾选(通过/失败)
> v0.3.5 对比: 同一任务集分别跑 0.3.0 与 0.3.5, 记录两侧 token/请求数/完成度/输出字数

| 任务 | 类型 | 描述 | 0.3.0 token | 0.3.5 token | 降幅% | 请求数(0.3.0→0.3.5) | 工具次数(0.3.0→0.3.5) | 完成度(0.3.0) | 完成度(0.3.5) | 输出字数(0.3.0→0.3.5) |
|---|---|---|---|---|---|---|---|---|---|
${rows}

## 决策
- 完成度 100% → 取总 token 最低档
- 总降幅目标 ≥50%（0.3.2~0.3.5 系列叠加）; 完成度 100%

## 智力门禁（v0.3.5, 任一项不满足即回退对应优化项）
| 维度 | 门槛 | 结果 |
|---|---|---|
| 工具选择准确率 | 10 个典型任务一致率 ≥95% | 待测 |
| 任务完成度 | 9 任务基准集完成度 100% | 待测 |
| 输出保真度 | 含数字/代码/路径/报错信息零丢失 | 待测 |
| 上下文召回 | 30+ 轮长会话回问早期事实一致 | 待测 |
| 功能回归 | 聊天/工具/路由/交接/记忆/定时/MCP/插件/主题/视觉零异常 | 待测 |
| 单点回退 | 性能区 11 开关逐个关闭验证 | 待测 |

## 失败任务归因（若有）
- 流程: 逐项关闭 T2 性能开关二分定位 → 定位到具体优化项 → 调参或维持关闭 → 记录于此
| 任务 | 现象 | 二分定位结果 | 处置 |
|---|---|---|---|
`

const out = join(__dirname, '..', 'docs', 'token-baseline-report.md')
writeFileSync(out, report, 'utf-8')
console.log('报告骨架已生成: ' + out)
console.log('提示: 需真实模型逐任务运行后填写 token/完成度(压缩档位对比)')
