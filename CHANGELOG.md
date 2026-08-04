# 更新日志

## v0.3.1（2026-08-04）

### 会话修复（块 A~F）
- 会话级并发状态模块 `session-state.ts`：取代全局 `window.__huangquan_agent` / 全局 streaming / 全局 taskGen
- 停止/重发/自动续跑：终止仅作用于当前会话（会话级任务代号 + abort 带会话过滤）
- send 幂等去重（同一内容 500ms 内重复发送忽略）
- 清空边界 / 中途保存（长任务每 30 秒自动落盘）
- 主进程保存队列：防抖合并、meta 写盘绑定、load 失败标记
- 多会话并发互不串台（Agent 状态/插话队列/阶段气泡全部会话级）

### 重构（块 G~N）
- **主进程拆分**：main.ts 108KB → 28KB，107 个 IPC handler 全部迁入 `electron/ipc/` 18 个域文件（行为零变化、通道名零变化）
- **SettingsView 拆分**：165KB → 11.9KB 壳，13 个 tab 迁入 `src/components/settings/`
- **chat.ts 拆分**：51KB → 10.4KB，send 主逻辑迁入 `chat-send.ts`
- **补丁注释清零**：94 处 `v0.x.x-fix` 前缀清理
- **组件层整理**：全部组件 ≤25KB（PlanningView/CodeView/PluginsView 拆分）
- **类型体系**：全库 any 清零（0 处）
- **测试基座**：vitest 引入，3 测试文件 10 用例

### v0.3.1 补丁（安全加固 + 构建门禁）
- **workflow 工具防挂起**：脚本未调用 `ctx.done` 或返回 Promise 后不 resolve 时，30 秒超时兜底 + 普通返回值自动收尾（原实现会永久卡住工具循环，stop 也救不回）
- **插件沙箱 fs 路径限制**：`require('fs')` 白名单全部包一层工作目录校验，插件不再能读取工作目录外的任意文件（与弹窗文案「仅限工作目录」一致）
- **构建类型门禁**：`npm run build` 增加渲染层 `tsc --noEmit`（原来只查 electron 端，渲染层类型错误不会让 CI 失败）
- **LLM 日志脱敏**：失败日志不再输出用户消息内容（只保留 role/工具结构）；`[LLM]` 调试日志收敛到 `HQ_LLM_DEBUG` 环境变量
- 插话队列补丁 M1~M4（有界合并/改向熔断/发送锁/序列断言）此前已并入本版

## v0.3.0（2026-07）
- 插件沙箱 / 供应商统一模板 / 视觉队列 / 多 Agent 协作修复 / 45 项全量回归
