// v0.3.4 T4 / v0.3.5 T3: token 基准测试 —— 9 任务基准集(与 docs/baseline-intelligence-report.md 同一套)
// 用法: node scripts/token-baseline.mjs [--ratio 0.60|0.70|0.80]
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

const rows = TASKS.map(t =>
  `| ${t.id} | ${t.type} | ${t.desc} | 待填 | 待填 | 待填 | 待填 | 待填 |`
).join('\n')

const report = `# Token 基准报告（压缩阈值档位: ${ratio}）

> 生成: ${new Date().toISOString()} · 任务集与 baseline-intelligence-report.md 一致(禁止修改)
> 每档跑完整 9 任务后填写; 完成度人工勾选(通过/失败)

| 任务 | 类型 | 描述 | 总 token(估算) | 总 token(usage) | 请求数 | 工具次数 | 完成度 |
|---|---|---|---|---|---|---|---|
${rows}

## 决策
- 完成度 100% → 取总 token 最低档
- 任一失败 → 回退上一档; 0.70 失败 → 维持 0.70 并记录原因
- 默认值记录: COMPACT_RATIO_DEFAULT = 0.7（当前）
`

const out = join(__dirname, '..', 'docs', 'token-baseline-report.md')
writeFileSync(out, report, 'utf-8')
console.log('报告骨架已生成: ' + out)
console.log('提示: 需真实模型逐任务运行后填写 token/完成度(压缩档位对比)')
