# B6-2 去重执行报告

> 日期：2026-08-07 | 基线：`npm run test` 17 文件 / 99 用例全绿，`npm run build` 通过

## 本轮合并到 `electron/shared/`

| 函数 | 位置 | 说明 |
|------|------|------|
| `errMsg` | `shared/errmsg.ts` | 两侧 re-export，行为不变 |
| `routeAgentCore` | `shared/route.ts` | 能力路由 + 领域路由纯函数，renderer/main 各留类型化包装 |
| `filterToolsCore` | `shared/tool-filter.ts` | 白名单过滤，engine 侧 `includeMcp: true`，renderer 侧 `false` |
| `parseMcpToolName` | `shared/mcp-utils.ts` | 两侧共用同一解析实现 |
| `scanMemoryText` | `shared/memory-utils.ts` | 记忆安全扫描模式表与实现合并 |
| `estimateTokens` | `shared/context-utils.ts` | renderer 只保留“取当前模型”的薄包装 |
| `outputLimit` | `shared/context-utils.ts` | 两侧共用同一分级逻辑 |
| `getModelContextLimit` | `shared/context-utils.ts` | 模型窗口表合并，renderer 的 `updateContextLimit` 调用共享版 |

## 保留双份（有意分叉，不做强合）

| 函数 | 原因 |
|------|------|
| `buildPrompt` / `buildContextualMessages` | renderer 从 zustand 读配置并回写 `onAgentRoute`，engine 由调用方传入 `EngineSettings/agents/memoryText/handoffContext` 等参数，签名与数据来源已分叉；强行合并风险大于收益 |
| `saveMemory` | `engine/memory.ts` 保存 `memory.json`（原子写），`memory/vector.ts` 保存向量库状态，语义不同，仅同名 |

## 验证

- `npm run test`：17 文件 / 99 用例通过
- `npm run build`：renderer + electron 双编译通过
- 净删除约 160 行重复实现（diff：+126 / -288）
