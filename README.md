# ⚔️ Acheron-agent

> 「在褪色成无的世界里，轻轻挥出一刀，将整片梦境带走。」
>
> 黄泉主题桌面 AI 助手。Electron + React + TypeScript。

---

## 🎭 这是什么

Acheron-agent 是一个有人格、有记忆、会自主行动的 Windows 桌面 AI 助手。它以《崩坏：星穹铁道》角色「黄泉」为灵魂，融合多 Agent 协作、语义记忆、任务规划、定时调度等能力。

**你和黄泉之间不只是问答**——她会记住你说过的话，拆解复杂任务，调度专业子 Agent 编队协作，在你不注意的时候按计划自主工作。

---

## ✨ 核心能力

### 🤖 多 Agent 编队

7 个内置专业 Agent，各司其职：

| Agent | 职责 | 风格 |
|-------|------|------|
| 👑 阎罗王 | 主控调度，任务分解，最终决策 | 权威果断 |
| 📜 判官 | 文档处理，报告撰写，翻译校对 | 严谨细致 |
| ⚔️ 钟馗 | 安全审计，代码审查，漏洞扫描 | 一针见血 |
| 🔔 无常 | 定时提醒，日程管理，事件监控 | 准时可靠 |
| 🌸 孟婆 | 情感陪伴，心理疏导，日常闲聊 | 温柔沉静 |
| 🎨 画师 | 视觉创作，UI 设计，配色方案 | 精确专业 |
| 💻 码师 | 全栈开发，脚本自动化，架构设计 | 代码优先 |

4 种协作模式：接力 Sequential / 路由 Router / 辩论 Debate / 监督 Supervisor。Agent 间可自动交接任务，传递上下文。

### 📋 Plan-Execute-Verify 执行循环

复杂任务自动拆解为结构化计划，分步执行、依赖管理、失败自动修正。每一步你都能看见——Agent 的思考过程不再是不透明黑箱。

### 🧠 记忆系统

语义向量记忆 + 重要性评分 + Token 预算 + 自动遗忘。黄泉记得你说过的重要事情，也会让无关紧要的慢慢淡去——像她的世界里永恒的雨。

### 🔌 MCP 协议 & Skills 生态

兼容 MCP 协议（Model Context Protocol），可连接本地工具服务器扩展能力。内置 code-review / data-analysis / project-manager / writing-assistant 四组 Skills，支持从 GitHub 安装社区技能。

### 🎛️ 插件系统（式神录）

manifest.json 声明式注册，目录扫描自动加载。可贡献工具、命令、Agent 模板。

### ⏰ 自主工作

Cron 定时任务 + 心跳巡检。设好计划，黄泉会在你不在时自己干活。

---

## 🏗️ 架构

```
Acheron-agent/
├── electron/               # Electron 主进程
│   ├── agent/              # 多 Agent 系统（编队 + Planner + 上下文）
│   ├── mcp/                # MCP 协议客户端
│   ├── memory/             # 语义向量记忆
│   ├── plugins/            # 式神录插件加载器
│   ├── scheduler/          # Cron 定时调度
│   ├── security/           # 权限控制
│   ├── workflow/           # 工作流模板引擎
│   ├── cache/              # 工具缓存
│   ├── main.ts             # 窗口 / IPC / 托盘
│   └── preload.ts          # 安全桥接
├── src/                    # React 渲染进程
│   ├── components/         # 15+ UI 组件
│   │   ├── ChatView        # 对话界面
│   │   ├── AgentsView      # Agent 编队面板
│   │   ├── PlanningView    # 执行计划可视化
│   │   ├── MemoryView      # 记忆管理
│   │   ├── SkillsView      # Skills 管理
│   │   ├── PluginsView     # 插件管理
│   │   ├── CronView        # 定时任务
│   │   └── ...
│   ├── store/              # Zustand 状态管理
│   └── styles/             # 暗色主题
└── resources/
    ├── skills/             # 内置技能包
    └── ishiki.md           # 黄泉人格定义
```

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/ATchangan/Acheron-agent/releases) 下载 `Acheron-agent-x.x.x.exe`，双击即用（Portable 免安装）。

### 首次配置

1. 启动后打开 **设置**
2. 选择 LLM Provider（DeepSeek / OpenAI / 自定义兼容 API）
3. 填入 API Key 和 Base URL
4. 选择对话模型
5. 开始对话

### 从源码构建

```bash
npm install
npm run dev           # 开发模式
npm run build         # 构建
npm run package:win   # 打包为 portable exe
```

---

## 🛡️ 安全

- 所有 API Key 存储在本地 `userData` 目录，不上传、不硬编码
- 工具调用在沙盒环境中执行
- 建议定期检查 [Releases](https://github.com/ATchangan/Acheron-agent/releases) 更新

---

## 📝 更新日志

### v0.2.0 (2026-07-30)

- 🆕 多 Agent 编队系统（7 Agent + 4 协作模式 + Handoff）
- 🆕 Plan-Execute-Verify 执行循环
- 🆕 MCP 协议客户端 (stdio + SSE)
- 🆕 语义记忆系统 v2（TF-IDF + 余弦相似度 + 自动遗忘）
- 🆕 式神录插件系统
- 🆕 Cron 定时调度 + 工作流模板引擎
- 🆕 安全权限模块
- 🆕 8 个新 UI 组件 + Skill 扩充至 4 组
- 🐛 修复 portable 模式 mkdirSync 崩溃

### v0.1.0 (2026-07-29)

- 🎉 初始发布：Electron + React + TypeScript
- 多 Provider LLM 支持 + 流式对话
- 会话管理 + 系统托盘
- Markdown 渲染 + 暗色主题

---

## 📄 关于

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电 忘川守 芽衣）。

---

## 📜 许可

Apache-2.0
