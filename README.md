# Acheron-Agent

![Acheron-Agent](docs/screenshot-home.png)

**本地优先的 Windows 桌面 AI 助手** —— 读写文件、执行命令、搜索网页、管理记忆，所有数据保存在本地，不上传。

[![GitHub Release](https://img.shields.io/github/v/release/ATchangan/Acheron-agent?style=flat-square)](https://github.com/ATchangan/Acheron-agent/releases/latest)
[![License](https://img.shields.io/badge/license-private-red?style=flat-square)]()

## 功能

**界面**
- 深色工作台风格，Archeron 主题（墨蓝底 + 雾紫字 + 近白强调）
- 单行输入框，模型选择器（搜索 / 供应商分组 / 刷新 / 编辑）
- 权限档盾牌下拉（只读 / 操作前询问 / 自动审核 / 完整权限）
- 配置档案条：设置快照/切换/导入
- 布局编辑器：侧边栏/右栏/状态栏/当日总结 显隐开关
- HUD 模式：迷你常驻输入条小窗

**会话**
- 流式 Markdown 渲染（代码高亮 / KaTeX / 交互卡片）
- 排队输入：任务运行中发送的消息排队为后续修改
- 活动行栈：工具调用按类别合并折叠
- 变更摘要卡：文件更改统计 + 文件清单 + 回滚
- 问题跳转编号时间线
- 会话置顶 / 归档 / 搜索 / 拖拽排序

**功能页**
- BOTS：预设角色助手（聊天式列表 + 一键发起会话）
- 消息平台：QQ 官方机器人（WebSocket + 被动回复）
- 任务：并行任务进度 + 历史记录
- 产物：跨会话文件/链接表格（筛选 + 搜索 + 分页）
- 定时任务：cron 表达式 / 文件监控触发
- 当日总结：今日活跃会话/完成任务/token 指标

**设置**（全屏弹窗 + 17 项平铺导航）
- 模型：默认模型 + 辅助模型行式配置 + 默认值推理
- 通知：任务完成 / 消息平台来信系统通知
- 记忆与上下文：持久记忆 / 压缩阈值 / 压缩目标 / 窗口覆盖
- 账单：按模型用量统计表 + 缓存命中率
- 已归档对话：归档列表 + 恢复/删除
- 网关：QQ 消息网关状态 + 重启
- 安全：默认权限档
- 外观：主题 / 皮肤 / 字号 / 信息密度 / 自定义 CSS

**其他**
- 记忆内核（MemoryCore sidecar）：自动沉淀对话记忆，按需检索
- 插件生态：对话生成插件 + 热加载 + MCP 服务器（stdio / SSE）
- 安全：L0-L4 风险分级 / 危险命令拦截 / DPAPI 密钥加密

## 技术栈

Electron 43 · React 19 · TypeScript 5.9 · Vite 7 · Zustand · node:sqlite · Playwright-core

## 快速开始

```powershell
npm install
npm run dev              # 开发运行
npm test                 # 单测（331 项）
npm run release:check    # 发布门禁
npm run package:win      # 打包 Windows 安装程序
```

## 目录结构

```
electron/    主进程（engine / ipc / shared / messaging / scheduler）
src/         渲染层（store / components / styles）
resources/   内置资源（图标 / 人设）
vendor/      内置依赖（memory-core 记忆内核）
scripts/     构建 / 测试 / 发布脚本
```

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 下载

[GitHub Releases](https://github.com/ATchangan/Acheron-agent/releases/latest)

## 隐私

- 所有数据存储在本地，不上传
- 模型密钥经 Windows DPAPI 加密
- 发布前自动执行内容合规与密钥扫描
