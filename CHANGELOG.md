# 黄泉Agent 更新日志

## v0.2.2 — 2026-08-01 (浏览器增强 + 文件浏览器 + GPU 渲染)

### 🌐 浏览器与网页解析
- 新增 **web_read 网页解析工具**（playwright-core + 系统 Edge 内核，无需额外安装浏览器）
- 浏览器设置合并为单一「🌐 浏览器」卡片（3 个子分组）

### 🎮 渲染与性能
- **GPU 渲染加速选项**：自动识别（auto / gpu / cpu 三档），RTX 系列实测硬件加速生效
- 流式渲染 40ms 节流，长回复更流畅
- 会话保存异步写盘，不再卡界面

### 📁 文件浏览器
- 右侧工作目录升级为 **FileTree 文件浏览器**：展开/折叠、双击打开、悬停重命名/删除、📂+/📄+ 新建
- 原生右键菜单（复制路径带引号），写操作限工作目录内

### ⚙️ 稳定性与配置
- 修复 Anthropic（Claude）鉴权：自动识别 x-api-key 而非 Bearer
- settings.json 大字段剥离至 avatar.dat / bgimage.dat（2.8MB → 9KB）
- Token 优化：工具结果截断（8000/3000/6000）、历史 40 条上限、记忆限量

### 📦 打包
- 打包方式由 Portable 改为 **NSIS 安装包**（可选安装目录、桌面快捷方式）
- 安装包内置 resources（人设 ishiki.md + 4 组技能），安装后功能完整
- 全新安装为空白配置，API Key 等均需重新填写

---

## v0.2.0 — 2026-07-30 (多Agent协作版)

### 🆕 v0.2 新增（对标主流开源Agent）

| 模块 | 来源灵感 | 说明 |
|------|----------|------|
| **Plan-Execute-Verify 循环** | OpenManus / LangGraph / Devin | 规划→执行→验证三步循环，结构化步骤管理、依赖检查、并行标记 |
| **多Agent协同编排** | CrewAI / AutoGen / OpenAI Swarm | 7人Agent编队（阎罗王/判官/钟馗/无常/孟婆/画师/码师），支持 handoff 交接 |
| **上下文窗口智能管理** | LangGraph / Claude Prompt Caching / MemGPT | 分层压缩：light(截断)/medium(50%摘要)/heavy(激进压缩)，中英混合Token估算 |
| **工具结果缓存** | LangChain Cache / Claude Prompt Caching | LRU+TTL缓存，读操作30s文件/120s搜索，写操作自动失效，最大500条 |
| **MCP SSE传输** | Anthropic MCP Spec 2024-11-05 | SSE/HTTP传输层补充，支持远程MCP服务器连接 |
| **工作流模板系统** | Dify / n8n / LangChain Chains | 6个内置模板：创建项目/代码审查/网络调研/文件整理/部署检查/每日总结 |
| **Human-in-the-Loop** | AutoGen / CrewAI | L3-L4风险操作确认门禁（安全模块增强） |

### 🔧 增强

- Agent路由升级：从5角色→7角色，新增画师(视觉)和码师(全栈开发)
- 工具总数：20→26（新增 handoff/list_agents/list_workflows/run_workflow/read_image）
- 工作模式提示词增强：多Agent编队信息 + 工作流模板 + 规划先行准则
- 自动上下文压缩：超过20条消息且>50K tokens时自动生成摘要
- `exec_command` UTF-8 强制输出修复

### 📁 新增文件

| 文件 | 说明 |
|------|------|
| `electron/agent/planner.ts` | Plan-Execute-Verify 循环引擎 |
| `electron/agent/multi-agent.ts` | 多Agent协同编排 + 7人编队 |
| `electron/agent/context.ts` | 上下文窗口管理 + Token估算 |
| `electron/agent/index.ts` | Agent子系统总出口 |
| `electron/cache/tool-cache.ts` | 工具结果LRU缓存 |
| `electron/workflow/templates.ts` | 工作流模板系统 |
| `electron/mcp/sse-transport.ts` | MCP SSE传输层 |

---

## v0.1.0 — 2026-07-30 (初始版本)

### 已完成模块（全部 Phase 1 + Phase 2 + Phase 3）

| 模块 | 状态 | 文件数 | 说明 |
|------|------|--------|------|
| 核心对话引擎 | ✅ | chat.ts | 流式SSE、双模式、插话打断、工具循环 |
| 20个内置工具 | ✅ | chat.ts + main.ts | 文件/命令/搜索/截图/剪贴板/进程/代码沙箱 |
| 4个浏览器工具 | ✅ | main.ts | browse/browse_screenshot/web_search/web_fetch |
| 2个RAG工具 | ✅ | memory/vector.ts | import_doc/recall_memory 语义搜索 |
| 2个定时任务工具 | ✅ | scheduler/cron.ts | schedule_task/list_schedules |
| 2个MCP工具 | ✅ | mcp/client.ts | mcp_connect/mcp_call 连接外部MCP服务器 |
| 插件系统 | ✅ | plugins/loader.ts | manifest.json目录式加载 |
| 安全系统 | ✅ | security/permission.ts | L0-L4风险分级 |
| 记忆系统 | ✅ | memory/vector.ts | TF-IDF向量+事实存储 |
| 4个内置技能 | ✅ | resources/skills/ | code-review/project-manager/data-analysis/writing |
| UI/UX | ✅ | ui-polish.css | 毛玻璃/悬浮/阴影/动画 |
| 三套主题 | ✅ | global.css | 暗色科技/浅色温润/深黑极简 |
| 设置系统 | ✅ | SettingsView.tsx | 6标签完整设置 |
| 终端面板 | ✅ | RightPanel.tsx | 工具调用可视化 |
| 模式切换 | ✅ | chat.ts + ChatView | 聊天/工作双模式+会话隔离 |
| 多模态 | ✅ | ChatInput.tsx | 图片上传+vision API |

### 工具总数：28
### 技能数：4
### 源文件数：~40
### ZIP大小：264KB
