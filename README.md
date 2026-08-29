# Acheron-Agent

开源仓库：[ATchangan/Acheron-agent](https://github.com/ATchangan/Acheron-agent)

Acheron-Agent 是一个**本地优先的 Windows 桌面 AI 助手**：能读写文件、执行命令、搜索网页，并调度一整套工具与插件生态完成任务。所有会话与数据均保存在本地，不上传。

![主界面](docs/screenshot-home.png)

## 核心能力（v0.5.0）

- **深色工作台界面**：首页大衬线字 hero、悬浮单行输入卡、侧栏菜单化（新建会话 / 技能与工具 / 产物 / 定时任务）、Archeron 默认主题与多套可选主题、皮肤背景与自定义 CSS
- **会话流式回复**：流式 Markdown 渲染（代码高亮 / KaTeX 公式 / 交互卡片）、推理过程展示、多轮上下文压缩、断点续跑；会话置顶 / 归档 / 搜索 / 导出
- **工具调用**：内置工具生态（文件 / 命令 / Git / 终端 / 网络 / 浏览器 / 桌面 / 沙箱代码），工具执行卡片（参数 / 结果 / 耗时 / 错误）、风险确认与权限分级、长任务进度与停滞兜底、失败归因与文件回滚
- **插件生态**：给助手说"给自己写一个 XXX 插件"即自动生成 manifest 并热加载；插件运行在独立进程并支持工具权限与设置卡片；另支持 MCP 服务器（stdio / SSE，自动注入工具 schema）
- **功能页**：定时任务（cron / 文件监控触发）、产物（工作目录文件浏览）、技能与工具（内置工具 / MCP / 插件聚合）
- **界面自定义**：多套主题与皮肤背景、信息密度、逐项显隐与自定义 CSS
- **安全与可靠性**：L0–L4 风险分级、危险命令拦截、模型密钥 DPAPI 加密、上下文压缩、渲染崩溃自动重建

## 技术栈

Electron 43 · React 19 · TypeScript 5.9 · Vite 7 · Zustand · node:sqlite · Playwright-core（浏览器自动化）· electron-updater

## 快速开始

```powershell
npm install          # 安装依赖
npm run dev          # 开发运行
npm test             # 单测
npm run release:check  # 发布门禁（lint / typecheck / test / brand 扫描）
npm run package:win  # 打包 Windows 安装程序
```

> 打包前请先关闭正在运行的 Acheron-Agent（应用会锁定 `release/win-unpacked` 下的文件）。

下载安装：[GitHub Releases](https://github.com/ATchangan/Acheron-agent/releases/latest)

## 目录结构

```
electron/    主进程与独立内核（engine / ipc / shared / memory / plugins）
src/         渲染层（store / components / styles）
resources/   内置资源（图标 / 人设）
scripts/     构建 / 测试 / 发布脚本
docs/        文档与截图
```

## 更新日志（重点）

### v0.4.4（2026-08-26）精简回归

- 能力收敛：仅保留**工具调用 / 插件 / 会话流式回复**；技能（skills）、多角色编队（agents）、长效记忆、知识库（藏书阁）、定时任务、命令中心 / 工作流、多媒体生成、配置档案、API Keys 独立页、诊断与模型缓存统计已移除
- 界面按开发版重写：左侧会话（聊天 / 工作双模式 + 置顶 / 归档 / 搜索）+ 底部导航（对话 / 浏览器 / 文件 / 设置）
- 设置页重组：供应商 / 策略 / 人格 / 工具 / MCP / 插件 / 外观 / 界面 / 快捷键 / 引擎 / 关于
- 稳定性与性能：主 bundle 分页加载、`tsc` 0 报错、全量单测通过

> 更早版本见 Git 历史。

## 隐私与安全

- 模型密钥经 Windows DPAPI 加密后存储于用户目录，源码与安装包不含任何用户数据
- 会话与数据全部保存在本地，不上传
- 发布前自动执行内容合规与密钥扫描（`npm run release:check`）
