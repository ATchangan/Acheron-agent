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

## v0.3.0（2026-07）
- 插件沙箱 / 供应商统一模板 / 视觉队列 / 多 Agent 协作修复 / 45 项全量回归
