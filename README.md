# Acheron-Agent

开源仓库：[ATchangan/Acheron-agent](https://github.com/ATchangan/Acheron-agent)

Acheron-Agent 是一个**本地优先的 Windows 桌面 AI 助手**：能读写文件、执行命令、搜索网页、定时干活，并调度一支多角色 Agent 编队并行协作。所有记忆与会话均保存在本地，不上传。

![主界面](docs/screenshot-home.png)

## 核心能力

- **独立内核 AgentEngine**：Agent 主循环、工具分发、记忆与计划全部运行在主进程，渲染层只消费事件流；支持断点恢复、计划确认门、回合内行内审批与自动复盘。
- **多角色编队**：主控 / 文档 / 安全 / 通知 / 陪伴 / 设计 / 开发，各自拥有工具白名单与私有记忆；`dispatch` 并行分发、`handoff` 带上下文交接。
- **工具生态**：62 个内置工具（文件 / 命令 / Git / 终端 / 网络 / 浏览器 / 多媒体 / 记忆 / 计划 / 协作 / MCP / 插件 / 技能），主控默认「核心工具模式」节省 token。
- **技能体系**：内置 10 个技能模板，支持自建、校验、命中统计与按日聚合；命中技能超预算时按相关度自动截断并记录 trace。
- **自写插件**：对助手说「给自己写一个 XXX 插件」，即自动生成 manifest 与 index.js，校验通过即热加载；插件运行在独立进程，文件 / 命令能力逐条回父进程裁决。
- **记忆与上下文**：本地 SQLite 单数据源（强杀不丢）+ FTS5 / 向量 RRF 双路检索 + 四层金字塔可溯源 + 三档衰减 + 事实去重与冲突淘汰；上下文压缩自动适配模型窗口。
- **安全与可靠**：L0–L4 风险分级、模型密钥 DPAPI 加密、危险命令黑名单、文件回滚快照、模型降级链、事件钩子 Hooks。
- **界面自定义**：侧边栏 / 聊天区 / 消息元素逐项显隐 + 信息密度三档 + 自定义 CSS；外观主题默认跟随系统，自定义背景自动按亮度适配文字颜色。

## 技术栈

Electron 43 · React 19 · TypeScript 5.9 · Vite 7 · Zustand · Playwright-core（浏览器自动化） · node:sqlite · electron-updater

## 快速开始

```powershell
npm install          # 安装依赖
npm run dev          # 开发运行
npm test             # 单测
npm run release:check  # 发布门禁（lint / typecheck / test / brand / key 扫描）
npm run package:win  # 打包 Windows 安装程序
```

> 打包前请先关闭正在运行的 Acheron-Agent（应用会锁定 `release/win-unpacked` 下的文件）。

下载安装：[GitHub Releases](https://github.com/ATchangan/Acheron-agent/releases/latest)

## 目录结构

```
electron/    主进程与独立内核（engine / ipc / shared / memory / scheduler）
src/         渲染层（store / components / styles）
resources/   内置资源（图标 / 人设 / 技能）
scripts/     构建 / 测试 / 发布脚本
docs/        文档与截图
```

## 更新日志（重点）

### v0.4.3（技能生态）

- 技能编辑器与 4 规则校验（含写盘路径白名单防穿越），新增 `skills:validate` / `skills:write` / `skills:stats`
- 技能命中统计按日聚合（hit / trigger / ok），设置页展示近 30 天命中率 / 触发率 / 成功率
- 内置技能模板 5 → 10（json-validator / log-troubleshoot / csv-clean / api-doc-gen / backup-script）
- 技能注入预算监控：命中超过 2 个时按相关度截断并记录 trace
- 产品更名为 Acheron-Agent，黄泉人设插画用于欢迎 / 侧栏 / 关于 / 角标
- 性能与稳定性：Vite 分包优化（主 bundle ~1.14MB → 346KB）、全局错误捕获、渲染崩溃自动重建；`noUnusedLocals + noUnusedParameters` 全开，`tsc` 0 报错；移除多余依赖
- 336 项测试全绿

### v0.4.2（UI 重构）

- 标题栏 / 侧栏 / 状态栏 / 设置页全面重排，输出统一为流式 Markdown 渲染
- 渲染进程崩溃后自动重建窗口、工具执行超时兜底、错误边界重构；Electron 升至 43.4.1

> 更早版本见 Git 历史。

## 隐私与安全

- 模型密钥经 Windows DPAPI 加密后存储于用户目录，源码与安装包不含任何用户数据
- 记忆、会话、轨迹全部保存在本地，不上传
- 发布前自动执行内容合规与密钥扫描（`npm run release:check`）
