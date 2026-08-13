# 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

开源仓库：[ATchangan/Acheron-agent](https://github.com/ATchangan/Acheron-agent)

一个以《崩坏：星穹铁道》角色「黄泉」为原型的 Windows 桌面 AI 助手：本地优先、能读写文件、执行命令、搜索网页、定时干活，并调度一支多角色 Agent 编队并行协作。

![主界面](docs/screenshot-home.png)

## 功能亮点

- **独立内核 AgentEngine**：Agent 主循环、工具分发、记忆、计划全部在主进程，渲染层只消费事件流；支持断点恢复、计划确认门、执行计划卡与自动复盘
- **多角色编队**：姬子 / 三月七 / 银狼 / 艾丝妲 / 知更鸟 / 黑天鹅 / 螺丝咕姆，各自拥有工具白名单与私有记忆；`dispatch` 并行分发、`handoff` 带上下文交接
- **工具与生态**：59 个内置工具（文件/命令/Git/终端/网络/浏览器/多媒体/记忆/计划/协作/MCP/插件/技能），主控默认「核心工具模式」省 token
- **记忆与上下文**：向量 + 关键词双路检索、容量封顶自动归档、约定类事实自动置顶、失败教训沉淀；上下文压缩自动适配模型窗口
- **安全与可靠**：L0-L4 风险分级、DPAPI 密钥加密、危险命令黑名单（可动态扩展）、文件回滚快照、模型降级链、事件钩子 Hooks
- **项目指令**：自动读取 `AGENTS.md` / `CLAUDE.md` / `.agents.md`（目录链合并、子目录按需注入、注入安全扫描）
- **可观测**：一键环境自检、引擎轨迹导出、token/成本统计、发布门禁

## 技术栈

Electron 32 · React 18 · TypeScript · Vite 5 · Zustand · Playwright-core（浏览器自动化）

## 快速开始

```powershell
npm install          # 安装依赖
npm run dev          # 开发运行
npm test             # 单测
npm run release:check  # 发布门禁(lint/typecheck/test/eval/brand/tag)
npm run package:win  # 打包 Windows 安装程序
```

> 打包前请先关闭正在运行的黄泉Agent（应用会锁定 `release/win-unpacked` 下的文件）。

## 更新日志（重点）

### v0.4.2（开发中）
- 桌宠 3D 建模：黄泉正常 / 大招（白发）两套 PMX 建模，three.js 渲染 + ammo 物理
- 程序化待机动画（呼吸 / 张望 / 眨眼）+ 可切换舞蹈动作（极乐净土 / 彩虹节拍 / Good Time）
- 形态与动作切换（设置页 / 右键菜单）、五态动画联动、大招红光气场；素材版权说明见 pet/models、pet/actions 的 NOTICE

### v0.4.0
- 记忆：本地 SQLite 持久化 + FTS5/向量双路检索 + 三档衰减 + 四层金字塔可溯源 + 事实去重
- 网关：任务类型路由（text/code/vision/long）+ 降级链 + 本地视觉服务自动切换
- 上下文：工具结果 side-channel + 四要素状态提炼 + 技能按需注入
- 桌宠：式神伴身（透明置顶、状态动画、定时提醒）

### v0.3.9
- 正确性：中文乱码修复、子代理统一执行管道、私有记忆隔离、模型降级链、密钥解密兜底
- 协作：强制 dispatch、handoff 带上下文、交付附「本次改进点」、长任务可并行新会话
- 记忆与技能：容量封顶自动归档、约定类自动置顶、内置技能可隐藏、技能同名用户优先
- 体验：复制按钮图标化、输出 Markdown 排版优化、全仓去 emoji/品牌词
- 工程：发布门禁、测试数据隔离；42 文件 248 用例全绿

### v0.3.8
- 项目指令生态（AGENTS.md/CLAUDE.md 目录链、子目录按需注入）、原生 git 工具、Hooks、任务回滚、自定义子代理
- PowerShell 7 全场景路由、计划一致性、一键环境自检、性能优化（同任务 61.6s→5.1s）

完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 目录结构

```
electron/    主进程与独立内核(engine/ipc/shared/memory/scheduler)
src/         渲染层(store/components/styles)
resources/   内置资源(图标/人设/技能)
scripts/     构建/测试/发布脚本
docs/        文档与截图
```

## 隐私与安全

- API Key 经 Windows DPAPI 加密后存储于用户目录，源码与安装包不含任何用户数据
- 记忆、会话、轨迹全部保存在本地，不上传
- 发布前自动扫描品牌词与密钥（`npm run release:check`）
