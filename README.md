# ⚔️ 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

有人格、有记忆、能自主行动的 Windows 桌面 AI 助手。Electron 32 + React 18 + TypeScript + Vite 5 + Zustand。

---

## 🎭 这是什么

黄泉Agent 是一个以《崩坏：星穹铁道》角色「黄泉」为灵魂的桌面 AI 助手。它不是简单的聊天壳，而是一套完整的 Agent 系统：能操作你的电脑、读写文件、执行命令、搜索网页、定时自主工作，还能调度一支「星穹列车」专业 Agent 编队并行协作。

**和黄泉的对话不是问答，是交付**：复杂任务自动拆解为可见执行计划，专业 Agent 各司其职，工具调用过程在右侧面板实时可视化。

---

## ✨ 核心能力

### 🚂 星穹列车 Agent 编队

7 个 Agent，全部拥有全工具权限，可交接（handoff）与并行分发（dispatch）：

| Agent | 职责 | 风格 |
|-------|------|------|
| ☕ 姬子 | 主控调度：任务分解、并行分发、结果汇总 | 沉稳干练 |
| 📸 三月七 | 文档处理：分析、报告、审核、翻译 | 活泼细致 |
| 🐺 银狼 | 安全与代码审查：漏洞扫描、风险预警 | 一针见血 |
| 📡 艾丝妲 | 任务调度与自动化：定时、监控、脚本 | 高效有序 |
| 🕊️ 知更鸟 | 情感陪伴与日常：闲聊、支持、建议 | 温柔治愈 |
| 🦢 黑天鹅 | 视觉与设计：图片理解、UI、配色、截图 | 优雅敏锐 |
| 🤖 螺丝咕姆 | 全栈开发：代码、项目、架构、自动化 | 逻辑缜密 |

姬子作为主控可调用 `dispatch` 把子任务并行分发给多个 Agent 独立执行，或用 `handoff` 交接上下文——复杂任务一次对话内多 Agent 接力完成。

### 🛠️ 40+ 内置工具

| 类别 | 工具 |
|------|------|
| 📁 文件 | read（分段+UTF-8安全）、write、edit、mkdir、grep、find、ls |
| 💻 系统 | exec_command（智能 PowerShell/cmd 检测）、system_info、process_list、kill_process |
| 🌐 网络 | web_search、web_fetch、browse（无头浏览器取全文）、browse_screenshot |
| 🖥️ 界面 | screenshot、clipboard_read/write |
| 🧠 记忆 | save_memory（可 pinned 跨 Agent 永久）、recall_memory（语义检索）、import_doc |
| ⚙️ 沙箱 | codebox（Python/Node 代码运行） |
| ⏰ 定时 | schedule_task（every 30m / at 09:00）、list_schedules |
| 🧩 MCP | mcp_connect（stdio）、mcp_call、mcp:sse（SSE 传输） |
| 🤝 Agent | handoff、dispatch、list_agents |
| 📋 工作流 | list_workflows、run_workflow（6 个内置模板） |
| 🎴 增强 | show_card（交互卡片）、bridge_notify（桌面通知）、workflow（JS 编排）、audit_log（审计）、watch_file（文件监控）、save_goal/list_goals（长期目标）、read_image、set_workdir、set_theme |

工具支持**开关控制**（设置里禁用）、**LRU+TTL 缓存**（读操作 30s / 搜索 120s，写操作自动失效）、**风险分级拦截**。

### 📋 Plan-Execute-Verify 执行循环

规划 → 分步执行 → 验证修正。依赖管理、失败自动重试、可并行标记，计划可视化——黄泉的思考过程不是黑箱。

### 🧠 语义记忆系统

TF-IDF 向量化 + 余弦相似度检索 + 重要性评分 + 每日衰减 + Token 预算（5000）+ 自动遗忘（最多 500 条）。支持 pinned 记忆跨 Agent 永久保留。

### 🧠 上下文智能管理

中英混合 Token 估算，按压力自动分层压缩：light（工具结果截断）/ medium（50% 摘要）/ heavy（保留 8 条 + 滚动摘要），自动适配模型上下文窗口（deepseek 1M / claude 200K / qwen 262K / gpt-4o 131K 等）。

### 🔌 MCP & Skills & 插件

- **MCP**：stdio + SSE 双传输，连接本地/远程 MCP 服务器发现并调用工具
- **Skills**：内置 code-review / data-analysis / project-manager / writing-assistant，支持 git clone 安装、创建、删除
- **插件（式神录）**：manifest.json 声明式注册，目录扫描自动加载

### 🎨 深度个性化

- **6 套主题**：暗色科技 / 浅色温润 / 深黑极简 / 森林 / 高对比 / 自定义配色
- **皮肤系统**：任意背景图，自动提取主色调融入 UI 强调色
- 窗口透明度、动画开关、字体大小、消息间距、聊天宽度
- **双人设**：聊天模式 = 黄泉官方精细人设（崩铁完整背景/台词/感官损伤设定），工作模式 = 高效执行人设，可自由编辑

### 🛡️ 安全与稳定

- **L0-L4 风险分级**：读 L0 / 普通写 L1 / 终端命令 L2 / 系统路径写 L3 / 删除与危险命令（rm -rf、format、shutdown 等黑名单）L4
- **文件权限四档**：full / sandbox（仅工作目录）/ readonly / ask
- v0.2.1 全局崩溃捕获 + crash.log + 渲染进程崩溃自动恢复 + 禁用 GPU 加速防渲染崩溃

---

## 🏗️ 架构

```
Acheron-agent/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 窗口/托盘/IPC/LLM流式/浏览器自动化/沙箱/崩溃捕获
│   ├── preload.ts             # contextBridge 安全桥（IPC 参数清洗）
│   ├── agent/                 # Agent 引擎
│   │   ├── planner.ts         # Plan-Execute-Verify 循环
│   │   ├── multi-agent.ts     # 多 Agent 注册/路由/协作
│   │   ├── context.ts         # Token 估算 + 分层压缩 + 用量统计
│   │   └── index.ts
│   ├── mcp/                   # MCP 客户端（stdio + SSE）
│   ├── memory/vector.ts       # TF-IDF 语义记忆（衰减/遗忘/预算）
│   ├── scheduler/cron.ts      # 定时任务（every Xm / at HH:MM，防漂移）
│   ├── security/permission.ts # L0-L4 风险分级 + 危险命令黑名单
│   ├── workflow/templates.ts  # 6 个工作流模板
│   ├── cache/tool-cache.ts    # 工具结果 LRU+TTL 缓存
│   └── plugins/loader.ts      # 式神录插件加载器
├── src/                       # React 渲染进程
│   ├── store/
│   │   ├── chat.ts            # 40+ 工具实现 + Agent 编队 + 工作流 + 权限检查
│   │   └── settings.ts        # 双人设 + 主题/皮肤/多媒体供应商 + 防抖保存
│   ├── components/
│   │   ├── ChatView.tsx       # 对话/工作双模式
│   │   ├── Sidebar.tsx        # 导航 + 会话管理
│   │   ├── RightPanel.tsx     # 工具调用终端 + 系统状态 + 记忆计数
│   │   ├── SettingsView.tsx   # 11 标签设置（供应商/策略/角色/记忆/协作/工具/多媒体/MCP/技能/外观/引擎）
│   │   ├── AgentsView.tsx     # Agent 编队面板
│   │   └── MemoryView.tsx     # 记忆管理
│   └── styles/                # 三套主题 + UI 抛光
└── resources/
    ├── skills/                # 4 组内置技能
    └── ishiki.md              # 黄泉人格定义
```

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/ATchangan/Acheron-agent/releases) 下载 `Acheron-agent-x.x.x.exe`，双击即用（Portable 免安装，绿色无残留）。

### 首次配置

1. 打开 **设置 → 供应商**，选择/添加 LLM Provider（DeepSeek / OpenAI / 自定义 OpenAI Compatible / 本地 Ollama）
2. 填写 API Key 与 Base URL（本地服务可留空）
3. **策略** 标签可配置模型分工：主对话 / 长文本 / 代码 / 快速响应 / 视觉辅助，或保持自动
4. 开始对话——默认聊天人设即「黄泉」

### 从源码构建

```bash
npm install
npm run build         # 构建
npm run package:win   # 打包为 portable exe
```

---

## 🛡️ 安全与隐私

- API Key 存储在本地 `userData/settings.json`，不上传、不硬编码
- 本地优先：对话、记忆、设置全部在本机
- 工具调用经 L0-L4 分级 + 文件权限四档控制
- 设置支持导出/导入 JSON 备份

---

## 📝 更新日志

### v0.2.3 (2026-08-01)

**安全加固**
- API Key / customHeaders / webReadCookies 经 **DPAPI（safeStorage）加密落盘**，不再明文保存
- 修复命令注入：skills/plugins 安装改用 spawn + 白名单校验
- 修复技能预览 XSS：renderMarkdown 全量转义 + 协议白名单
- 修复会话路径穿越：会话 id 白名单校验；sandbox 权限路径规范化（防 .. 穿越）
- workflow 工具加固（限长 8KB + 严格模式）；mkdir 走 IPC（工作目录校验），不再拼 shell
- abort 按 requestId 精确中止（多会话并发互不误杀）
- 每工具权限表（ToolsView）接入 runTool，deny/ask 生效

**新功能**
- 独立浏览器窗口 + 使用中悬浮窗（hash 路由 #browser / #float）
- **TTS 语音朗读**（Windows SAPI，离线可用）
- 常驻无头浏览器 + 实时快照（agent 浏览时页面保持打开，前端可实时截图查看）
- 单实例锁（防止多实例并行干扰悬浮窗/窗口）
- 思考气泡模式：工具过程统一显示在「思考气泡」内，消息流保持干净
- 大图压缩（≤1280px JPEG 0.8），避免本地视觉模型超时 + 会话文件膨胀

**修复与性能**
- read 工具 offset/limit 透传主进程分段读（>5MB 续读）
- grep/find 异步化（fs.promises）+ glob 转义修复 + 扩展名正则修复
- recall_memory 接入向量语义检索 + 关键词合并
- 会话元数据缓存（避免 list 全量解析大会话）
- MCP SSE 改用 net.fetch（跟随系统代理）
- 时间戳置于 prompt 绝对末尾，缓存命中率 13% → 30%+
- 崩溃日志异步追加；清理主进程双 Agent 体系与 planner/workflow 死代码（6 文件）

### v0.2.2 (2026-08-01)

**浏览器与网页解析**
- 新增 **web_read 网页解析工具**（playwright-core + 系统 Edge 内核，无需额外安装浏览器）
- 浏览器设置合并为单一「🌐 浏览器」卡片（3 个子分组）

**渲染与性能**
- **GPU 渲染加速选项**：自动识别（auto / gpu / cpu 三档），RTX 系列实测硬件加速生效
- 流式渲染 40ms 节流，长回复更流畅
- 会话保存异步写盘，不再卡界面

**文件浏览器**
- 右侧工作目录升级为 **FileTree 文件浏览器**：展开/折叠、双击打开、悬停重命名/删除、📂+/📄+ 新建
- 原生右键菜单（复制路径带引号），写操作限工作目录内

**稳定性与配置**
- 修复 Anthropic（Claude）鉴权：自动识别 x-api-key 而非 Bearer
- settings.json 大字段剥离至 avatar.dat / bgimage.dat（2.8MB → 9KB）
- Token 优化：工具结果截断（8000/3000/6000）、历史 40 条上限、记忆限量

**打包**
- 打包方式由 Portable 改为 **NSIS 安装包**（可选安装目录、桌面快捷方式）
- 安装包内置 resources（人设 ishiki.md + 4 组技能），安装后功能完整
- 全新安装为空白配置，API Key 等均需重新填写

### v0.2.1 (2026-08-01)

**稳定性**
- 全局崩溃捕获：主进程异常记录 crash.log 不再直接崩溃
- 禁用 GPU 硬件加速，防止 GPU 进程崩溃导致窗口渲染异常
- 渲染进程崩溃自动恢复（render-process-gone 监听 + 自动重载）
- IPC 安全序列化：消除循环引用 / Proxy / 不可序列化对象导致的报错
- 文件读取 UTF-8 多字节边界修正，不再截断中文
- 图片读取限制 20MB、目录扫描限制深度 8 / 5000 文件，防大目录阻塞

**Agent 与 LLM**
- Agent 编队改为**星穹铁道角色**（姬子/三月七/银狼/艾丝妲/知更鸟/黑天鹅/螺丝咕姆）
- AbortController 替代全局标志位，支持并发请求与多工具调用累积
- 新增 `llm:chatOnce` 非流式调用：多 Agent 分发时子 Agent 独立执行
- 新增 `llm:vision` 视觉辅助接口：主模型不支持多模态时自动切视觉模型
- 新增 `media:describe` 多媒体能力探测（LM Studio 本地视觉 / 即梦 / Agnes / 可灵）
- 修复非 DeepSeek Provider 全部报「不支持的 Provider」（支持 OpenAI Compatible 类型）
- 支持自定义请求 Headers（JSON 或 key=value）
- 修复 baseUrl 已含 /v1 或 /v4 时路径重复问题

**功能**
- 对话历史导出（md / json / txt 到工作目录）
- 清空全部对话历史、恢复出厂设置
- 最小化 / 关闭缩至托盘设置
- 文件权限四档（full / sandbox / readonly / ask）
- 工具开关（禁用列表过滤）
- 真实存储统计（会话/记忆/插件/缓存/工作区/设置）
- 定时任务基于计划时间计算下次触发，防止漂移累积
- 写操作时同步失效缓存

### v0.2.0 (2026-07-30)

- 🚂 多 Agent 协作系统：7 角色编队 + handoff 交接 + dispatch 并行分发
- 📋 Plan-Execute-Verify 执行循环
- 🧠 语义记忆系统 v2（TF-IDF + 余弦相似度 + 衰减遗忘 + Token 预算）
- 🧠 上下文窗口智能管理（分层压缩 + Token 估算）
- 💾 工具结果缓存（LRU+TTL，写操作自动失效）
- 🔌 MCP 客户端（stdio + SSE 双传输）
- 🔄 工作流模板系统（6 个内置模板）
- 🛡️ L0-L4 风险分级权限 + 危险命令黑名单
- 🎨 8 个新 UI 组件 + 皮肤系统（背景图自动提色）
- 📚 Skills 扩充至 4 组 + 式神录插件系统
- 🐛 修复 portable 模式 mkdirSync 启动崩溃

### v0.1.0 (2026-07-29)

- 🎉 初始发布：Electron + React + TypeScript
- 多 Provider LLM 支持 + 流式对话
- 20 个内置工具 + 浏览器自动化 + 代码沙箱
- 会话管理 + 系统托盘 + 三套主题
- 聊天/工作双模式切换

---

## 📄 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电·忘川守·芽衣）。出云国最后的幸存者，背负终极诏刀「忘川」的巡海游侠，主动踏入虚无的自灭者——世界于她只剩黑白灰，红色是唯一能清晰辨识的色彩，是记忆、是故人、也是她存在于此的证明。

> 「下雨了，要一起走段路吗？我带了伞。」

---

## 📜 许可

Apache-2.0

