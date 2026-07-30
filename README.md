# 黄泉Agent

桌面级 AI 助手。基于 Electron + React + TypeScript。

## 快速开始

```bash
npm install
npm run dev        # 开发模式
npm run build      # 构建
npm start          # 启动 (构建后)
npm run package:win # 打包
```

## 架构

```
huangquan-agent/
├── electron/
│   ├── agent/           # 多 Agent 协作系统
│   │   ├── multi-agent.ts   # 7 个内置 Agent 编队
│   │   ├── planner.ts       # Plan-Execute-Verify 循环
│   │   ├── context.ts       # 上下文管理
│   │   └── index.ts
│   ├── mcp/             # MCP 协议客户端
│   │   ├── client.ts        # stdio transport
│   │   └── sse-transport.ts
│   ├── memory/          # 语义记忆系统
│   │   └── vector.ts        # TF-IDF 向量化
│   ├── plugins/         # 插件系统 (式神录)
│   │   └── loader.ts
│   ├── scheduler/       # 定时调度器
│   │   └── cron.ts
│   ├── security/        # 安全权限模块
│   ├── workflow/        # 工作流模板引擎
│   ├── cache/           # 工具缓存
│   ├── main.ts          # 窗口、IPC、系统托盘
│   └── preload.ts       # 安全桥接
├── src/
│   ├── components/      # UI 组件 (15+)
│   ├── store/           # 状态管理 (Zustand)
│   ├── styles/          # 全局样式
│   └── global.d.ts      # 类型定义
├── resources/
│   ├── skills/          # 内置技能
│   │   ├── code-review/
│   │   ├── data-analysis/
│   │   ├── project-manager/
│   │   └── writing-assistant/
│   └── icon.png
└── electron-builder.yml
```

## 功能

- [x] 多 Provider 支持 (DeepSeek / OpenAI / 兼容 API)
- [x] 流式对话 + Markdown 渲染
- [x] 会话管理 (创建/切换/删除)
- [x] 系统托盘 + 本地数据持久化
- [x] 多 Agent 协作 (7 个内置 Agent，4 种协作模式)
- [x] Plan-Execute-Verify 任务执行循环
- [x] MCP 协议客户端
- [x] 语义记忆系统 (TF-IDF + 余弦相似度 + 自动遗忘)
- [x] 插件系统 (式神录)
- [x] Cron 定时调度
- [x] 工作流模板引擎

---

## 更新日志

### v0.2.0 (2026-07-30)

#### 🤖 多 Agent 协作系统
- 内置 **7 个专业 Agent**：阎罗王（主控调度）、判官（文档处理）、钟馗（安全审计）、无常（任务调度）、孟婆（情感陪伴）、画师（视觉创作）、码师（代码实现）
- 支持 **4 种协作模式**：接力 Sequential / 路由 Router / 辩论 Debate / 监督 Supervisor
- Agent 间可 **自动交接** (Handoff)，传递上下文

#### 📋 Plan-Execute-Verify 执行循环
- 任务自动拆解为结构化执行计划
- 分步执行，依赖管理，失败自动修正重试
- 计划可视化，用户可感知 Agent 思考过程

#### 🔌 MCP 协议客户端
- 支持连接本地 MCP 服务器 (stdio transport / SSE)
- 自动发现并注册远程工具
- JSON-RPC 2.0 协议通信

#### 🧠 语义记忆系统 v2
- TF-IDF 向量化 + 余弦相似度检索
- 重要性评分 + Token 预算控制
- 自动遗忘 + 衰减机制

#### 🎭 插件系统（式神录）
- 插件目录扫描与自动加载
- manifest.json 声明式注册工具/命令

#### ⏰ 定时调度器
- Cron 表达式任务调度
- 持久化任务列表

#### 🔄 工作流模板引擎
- 预定义工作流模板，参数化执行

#### 🛡️ 安全权限模块
- 工具调用权限分级，沙箱策略控制

#### 🎨 UI 新增组件
- AgentsView / PlanningView / MemoryView / KnowledgeView
- PluginsView / SkillsView / ToolsView / CronView / CodeView
- 深色主题 UI 抛光

#### 📦 新增 Skills
- data-analysis / project-manager / writing-assistant

---

### v0.1.0 (2026-07-29)

- Electron + React + TypeScript 基础框架
- 多 Provider LLM 支持
- 流式对话 + Markdown 渲染
- 会话管理 + 系统托盘
- 本地持久化存储
