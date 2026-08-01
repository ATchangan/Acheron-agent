# ⚔️ 黄泉Agent · Acheron-agent

> 「在褪色成无的世界里，轻轻挥出一刀，将整片梦境带走。」

有人格、有记忆、能自主行动的 Windows 桌面 AI 助手。Electron + React + TypeScript。

---

## 🎭 这是什么

黄泉Agent 是一个桌面级 AI 助手，以《崩坏：星穹铁道》角色「黄泉」（Acheron）为灵魂，将 Agent 能力带到桌面端——记住你说过的每句话、操作电脑、读写文件、执行代码、管日程，还能调度专业子 Agent 编队协作完成任务。

**你和黄泉之间不只是问答**：她会记住重要的事，把复杂任务拆解成可见的执行计划，让专业 Agent 各司其职，在你不注意的时候按计划自主工作。

---

## ✨ 核心能力

### 🤖 多 Agent 编队

7 个内置专业 Agent，各司其职，可自动交接任务：

| Agent | 职责 | 风格 |
|-------|------|------|
| 👑 阎罗王 | 主控调度，任务分解，最终决策 | 权威果断 |
| 📜 判官 | 文档处理，报告撰写，翻译校对 | 严谨细致 |
| ⚔️ 钟馗 | 安全审计，代码审查，漏洞扫描 | 一针见血 |
| 🔔 无常 | 定时提醒，日程管理，事件监控 | 准时可靠 |
| 🌸 孟婆 | 情感陪伴，心理疏导，日常闲聊 | 温柔沉静 |
| 🎨 画师 | 视觉创作，UI 设计，配色方案 | 精确专业 |
| 💻 码师 | 全栈开发，脚本自动化，架构设计 | 代码优先 |

支持 4 种协作模式：**接力** Sequential / **路由** Router / **辩论** Debate / **监督** Supervisor。Agent 间通过 Handoff 自动交接，传递上下文。

### 📋 Plan-Execute-Verify 执行循环

复杂任务自动拆解为结构化执行计划：规划 → 分步执行 → 验证修正。依赖管理、失败自动重试，每一步都可视化——黄泉的思考过程不是黑箱。

### 🧠 语义记忆系统

TF-IDF 向量化 + 余弦相似度检索，配合重要性评分、Token 预算和自动遗忘机制。黄泉记得住重要的事，也让无关紧要的慢慢淡去。

### 🔧 26+ 内置工具

文件读写、命令执行、网页搜索、截图、剪贴板、进程管理、代码沙箱、图片识别……工具调用过程在右侧终端面板实时可视化。

### 🔌 MCP 协议 & Skills 生态

支持 MCP 协议（stdio + SSE 双传输），可连接本地工具服务器。内置 4 组 Skills：代码审查 / 数据分析 / 项目管理 / 写作助手。

### 🎛️ 插件系统（式神录）

manifest.json 声明式注册，目录扫描自动加载，可扩展工具、命令、Agent 模板。

### ⏰ 自主工作

Cron 定时任务 + 心跳巡检。设好计划，黄泉会在你不在时按计划自主执行。

### 🛡️ 安全分级

L0-L4 风险分级权限控制，高危操作（删除、命令执行）需确认，Human-in-the-Loop 人工介入门禁。

---

## 🏗️ 架构

```
Acheron-agent/
├── electron/               # Electron 主进程
│   ├── agent/              # 多 Agent 系统（planner + multi-agent + context）
│   ├── mcp/                # MCP 客户端（stdio + SSE）
│   ├── memory/             # 语义向量记忆
│   ├── plugins/            # 式神录插件加载器
│   ├── scheduler/          # Cron 定时调度
│   ├── security/           # L0-L4 权限分级
│   ├── workflow/           # 工作流模板引擎
│   ├── cache/              # 工具结果 LRU 缓存
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
│   │   ├── CodeView        # 代码查看
│   │   └── ...
│   ├── store/              # Zustand 状态管理
│   └── styles/             # 三套主题（暗色科技/浅色温润/深黑极简）
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
npm run build         # 构建
npm run package:win   # 打包为 portable exe
```

---

## 🛡️ 安全与隐私

- API Key 存储在本地 `userData` 目录，不上传、不硬编码
- 本地优先：对话记录、记忆、设置全部保存在本机
- 工具调用经 L0-L4 分级权限控制

---

## 📝 更新日志

### v0.2.0 (2026-07-30)

- 🤖 多 Agent 编队系统：7 Agent（阎罗王/判官/钟馗/无常/孟婆/画师/码师），4 种协作模式，Handoff 交接
- 📋 Plan-Execute-Verify 执行循环：规划→执行→验证，依赖管理，失败自动重试
- 🧠 上下文窗口智能管理：分层压缩（截断/摘要/激进压缩），中英混合 Token 估算
- 💾 工具结果缓存：LRU+TTL，写操作自动失效
- 🔌 MCP 客户端升级：stdio + SSE 双传输
- 🔄 工作流模板系统：6 个内置模板（创建项目/代码审查/网络调研/文件整理/部署检查/每日总结）
- 🛡️ Human-in-the-Loop：L3-L4 风险操作确认门禁
- 🎨 8 个新 UI 组件：Agents/Planning/Memory/Knowledge/Plugins/Skills/Tools/Cron/Code
- 🐛 修复 portable 模式 mkdirSync 崩溃

### v0.1.0 (2026-07-29)

- 🎉 初始发布：Electron + React + TypeScript
- 多 Provider LLM 支持 + 流式对话
- 20 个内置工具 + 4 个浏览器工具 + 2 个 RAG 工具 + 2 个定时任务工具 + 2 个 MCP 工具
- 会话管理 + 系统托盘 + 三套主题
- 聊天/工作双模式切换

---

## 📄 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电 忘川守 芽衣）。她是出云国最后的幸存者，背负「无」之刀的巡海游侠，行走于「有」与「无」的狭间。

---

## 📜 许可

Apache-2.0
