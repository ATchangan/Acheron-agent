# 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

一个以《崩坏：星穹铁道》角色「黄泉」为原型的 Windows 桌面 AI 助手。它不只是一个聊天窗口：能读写文件、执行命令、搜索网页、定时干活，还能调度一支由星穹铁道角色组成的 Agent 小队并行协作。技术栈是 Electron 32 + React 18 + TypeScript + Vite 5 + Zustand。

和它对话不是问答，是交付。复杂任务会被拆成看得见的执行步骤，Agent 各干各的，每一步在聊天流里实时可见。

---

## 主要功能

### 星穹列车 Agent 编队

内置 7 个 Agent，各有领域工具白名单，支持交接（handoff）和并行分发（dispatch）：

- 姬子：主控调度，负责任务分解、分发和汇总
- 三月七：文档处理，分析、报告、翻译
- 银狼：安全与代码审查，查漏洞、盯风险
- 艾丝妲：任务调度与自动化，定时任务、监控、脚本
- 知更鸟：情感陪伴与日常闲聊
- 黑天鹅：视觉与设计，看图、配色、截图
- 螺丝咕姆：全栈开发，代码、项目、架构

v0.3.0 起每个 Agent 有真实的工具白名单和能力路由，子 Agent 之间上下文隔离，编队管理页可以编辑白名单并持久化。姬子可以调用 `dispatch` 把子任务分给多个 Agent 并行执行，或者用 `handoff` 交接上下文。v0.3.3 起 dispatch 并发上限真正生效（超出自动排队）、子任务有独立 token 预算、角色可配置专属模型、交接行为可开关。

### 工作步骤卡片（v0.3.3）

AI 工作过程以聊天流内的自然语言步骤卡片展示，不再需要盯着右侧终端：

- 每次调用工具前，模型先用一句话说明这一步在做什么
- 工具以 chips 显示实时状态（进行中/完成/失败），点击可展开参数与完整结果
- 同一任务的多张卡片自动合并为「任务进程卡」（N步 · M工具 · 总耗时），执行中展开、完成后自动收起
- 文件树/工作目录/系统信息在左侧导航的「文件」视图

### 独立内核 AgentEngine（v0.3.3）

Agent 主循环迁入主进程：LLM 直连、工具分发、上下文构建、记忆、模型调度、视觉队列、子任务 dispatch 全部由引擎接管，渲染层只消费事件流。支持断点落盘恢复（应用重启后可从断点继续）、计划确认门（实验）——首次调用工具前展示执行计划，批准后才动手。

### 40+ 内置工具

- 文件：read（分段读取，支持 >5MB 续读）、write、edit、mkdir、grep、find、ls
- 系统：exec_command（自动识别 PowerShell/cmd，可被「停止」递归打断）、system_info、process_list、kill_process
- 网络：web_search、web_fetch、browse（可访问性快照 + `@编号` 交互元素）、browser_click / browser_type / browser_press / browser_scroll / browser_console / browser_vision（真正操作网页）、browse_screenshot、web_read（系统 Edge 解析网页）
- 界面：screenshot、clipboard_read/write
- 多媒体：TTS 语音朗读（Windows 自带语音，离线可用）、read_image（自动压缩）
- 记忆：save_memory（可置顶跨 Agent 保留）、recall_memory（向量语义检索）、import_doc
- 沙箱：codebox（跑 Python/Node 代码）
- 定时：schedule_task、list_schedules
- MCP：mcp_connect（stdio）、mcp_call、mcp:sse（SSE 传输，跟随系统代理）；已连接服务器的工具自动注入（`mcp__服务器__工具`），逐工具权限（默认 ask）
- Agent：handoff、dispatch、list_agents
- 工作流：list_workflows、run_workflow（6 个内置模板）
- 其他：show_card、bridge_notify、audit_log、watch_file、save_goal/list_goals、set_workdir、set_theme

工具可以单独开关，有 LRU+TTL 缓存（读操作 30 秒、搜索 120 秒，写操作自动失效；v0.3.3 起缓存自动释放：文件缓存 32MB/10min 上限），每个工具还有独立的权限设置（deny / ask / full）。插件通过 index.js 协议在 vm 沙箱里运行（require 白名单、10 秒超时、4KB 输出截断），插件工具可以直接注入给 LLM 调用。

### 记忆与上下文

- 语义记忆：TF-IDF 向量化 + 余弦相似度检索，按重要度评分、每日衰减、有 Token 预算和自动遗忘上限（500 条）。v0.2.4 起嵌入引擎可配置，中文用 bigram 分词，检索更准
- 上下文管理：中英混合 Token 估算，压力大时自动分层压缩（截断 → 摘要 → 激进压缩），自动适配不同模型的窗口大小（deepseek 1M / claude 200K / qwen 262K 等）
- v0.3.3 起多轮对话完整历史入引擎（不再丢跨轮记忆），会话搜索升级 FTS5-lite 倒排索引（英文单词 + 中文 bigram，增量更新）

### 视觉与媒体

- 发图时自动判断：当前模型不支持视觉就自动切到可用的视觉模型（同供应商优先），支持就不切，没有可用模型会明确提示
- 视觉任务走独立队列：识图类任务强制用「视觉理解」模型，不用纯文本模型硬看；调用失败自动顺位下一个，全部失败会给清晰报错；任务完成后自动切回主力模型
- 对话里提到生图、生视频会自动调用媒体工具（策略页可关掉自动生成，改成明确要求才生成）

### 安全

- API Key、自定义 Headers、网页 Cookie 全部用 Windows DPAPI 加密落盘，不存明文
- L0-L4 风险分级：读文件 L0，普通写入 L1，终端命令 L2，系统路径写入 L3，删除和危险命令（rm -rf、format、shutdown 等黑名单）L4
- L2/L3 风险操作软件内确认：右下角确认卡片（拒绝/允许 + 「本次任务都批准」，60 秒无人操作自动拒绝），不再弹原生 Windows 窗口；只读查询命令不打扰
- 文件权限四档：full / sandbox（限工作目录）/ readonly / ask
- 命令执行走 spawn + 白名单，会话 ID 白名单防路径穿越，Markdown 渲染全量转义防 XSS
- 主窗口渲染沙箱 + 页面 CSP；插件在 vm 沙箱里执行，require 白名单 + 超时 + 输出截断
- 记忆安全扫描：写入前检测 API Key/凭证/提示注入

### 其他

- 聊天界面极简终端式：用户消息 `❯` 强调色、助手 Markdown 通栏（流式实时渲染）、工具结果缩进变暗；回到底部按钮、复制最后回复、错误一键重试
- 会话置顶（📌 永久保留，不受裁剪）；会话保存异步原子写，崩溃不丢数据
- 6 套主题 + 皮肤系统（背景图自动提取主色调），窗口透明度、动画、字号都可调
- 聊天/工作双模式，两种人设（黄泉完整人设 / 高效执行人设）都可以自己编辑
- 自动更新：启动时检查 GitHub Releases，有新版本会提示
- 工作目录可以自定义，改完聊天右侧的文件树立即刷新；设置页和右侧面板都能快速切换工作目录
- 定时任务（艾丝妲驱动）、藏书阁、式神插件系统，全界面中文化
- 诊断轨迹：agent-trace.jsonl 记录完整调用链，设置页「诊断」Tab 可过滤/查看/清空（纯本地）

---

## 项目结构

```
Acheron-agent/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 窗口/托盘/生命周期
│   ├── engine/                # AgentEngine 独立内核（v0.3.3）
│   │   ├── engine.ts          # Agent 主循环（LLM 直连/工具分发/事件流）
│   │   ├── llm-core.ts        # LLM 流式调用（超时/重试/截断自适应）
│   │   ├── reliability.ts     # 可靠性（指数退避/token 预算/断点）
│   │   ├── context.ts         # 上下文构建（记忆/归档/折叠）
│   │   ├── memory.ts          # 语义记忆
│   │   ├── agents.ts          # Agent 编队定义
│   │   ├── registry.ts        # 工具 handler 注册表
│   │   └── tools.ts           # 主进程工具实现
│   ├── ipc/                   # 22 个域文件（引擎/任务/诊断/风险确认等）
│   ├── preload.ts             # contextBridge 安全桥
│   ├── webtools.ts            # 网页解析(playwright-core + 系统 Edge)
│   ├── mcp/                   # MCP 客户端(stdio + SSE)
│   ├── scheduler/cron.ts      # 定时任务
│   ├── security/permission.ts # L0-L4 风险分级
│   ├── fs-atomic.ts           # 原子写
│   └── plugins/loader.ts      # 插件加载(vm 沙箱执行层)
├── src/                       # React 渲染进程
│   ├── store/
│   │   ├── chat.ts            # 聊天主 store（事件流消费/消息模型）
│   │   ├── session-state.ts   # 会话级并发状态
│   │   ├── settings.ts        # 人设/主题/供应商设置
│   │   └── tools.ts           # 工具 Schema（注入白名单过滤）
│   ├── components/
│   │   ├── settings/          # 16 个设置 tab（含诊断）
│   │   └── ...                # 聊天/文件树/浏览器/悬浮窗等界面
├── resources/
│   ├── skills/                # 4 组内置技能
│   └── ishiki.md              # 黄泉人格定义
├── docs/                      # 自检报告与开发文档
├── scripts/                   # 构建门禁脚本
└── .github/workflows/         # CI 自动构建(推 tag 自动出安装包)
```

---

## 快速开始

### 安装

从 [Releases](https://github.com/ATchangan/Acheron-agent/releases) 下载 `Acheron-agent-x.x.x.exe`，双击安装（NSIS 安装包，可选安装目录、创建桌面快捷方式）。也支持覆盖安装升级，旧数据不会丢。

### 首次配置

1. 打开「设置 → 供应商」，添加 LLM 服务商（DeepSeek / OpenAI / OpenAI Compatible / 本地 Ollama 等）
2. 填 API Key 和 Base URL。Key 会用系统级 DPAPI 加密保存，不会明文写在磁盘上。供应商面板会预填常用服务的 BaseURL 和 API 类型
3. 「策略」页可以指定不同任务用哪个模型（主对话 / 长文本 / 代码 / 快速响应 / 视觉），不配就全自动
4. 直接开始聊。默认就是黄泉人设

安装后是全新空白配置，所有 API Key、供应商、人设都要自己填。你的数据只存在本机（`%APPDATA%\huangquan-agent`），安装包和仓库里都没有任何人的私密信息。

### 从源码构建

```bash
npm install
npm run build         # 构建渲染层 + 主进程(含 tsc 严格类型检查)
npm run package:win   # 打包 NSIS 安装包
```

---

## Token 优化（v0.3.2 起内置）

全系列目标：**不降智力、不降质量**的前提下降低每次 LLM 请求消耗。闲聊单请求省 70%+、复杂任务省 50%+（以基准报告实测为准）。

| 优化 | 说明 | 开关 |
|---|---|---|
| 工具白名单注入 | 按 Agent 只注入其领域工具（闲聊 ~6000 → ~800 token） | 设置→引擎→性能优化 |
| 工具 schema 中文精简 | 描述精简，参数/安全限制保留 | 内置，无开关 |
| 结果瘦身 | >1500 字符截断保留头尾+关键行 | resultSlim |
| 记忆按需裁剪 | 相关度 top5 + 总量护栏 2500 | memoryTrim |
| 工作流按需注入 | 命中触发词才注入完整列表 | workflowLazy |
| 历史轮次折叠 | 旧工具轮次折叠为归档摘要 | roundFold |
| 输出上限分级 | 闲聊短消息上限 800，工具轮 4096 | outputCap |
| 历史图片降级 | 旧轮次图片降级文字，最新消息保留 | imgDowngrade |
| 工具参数截断 | 超长参数截断，定位字段保留 | argSlim |
| 跨任务归档 | 完成任务折叠为归档记录 | taskArchive |
| 插话合并 | 多段插话合并单条注入 | interjectMerge |
| 并行结果护栏 | 并行结果总量超限自动瘦身 | parallelCap |
| 估算校准 | 分层估算 + 按模型 EMA 实测校准 | 内部机制，无开关 |

全部优化集中在 设置→引擎→性能优化（Token），默认全开、单点回退、恢复默认。前缀缓存友好：system prompt 头部字节级稳定，动态内容只追加尾部（`node scripts/check-prefix-stable.mjs` 验证）。

---

## 更新日志

### v0.3.3 (2026-08-06)

- **独立内核 AgentEngine**：主循环迁入主进程，渲染层纯客户端；断点落盘可恢复
- **工作步骤卡片**：移除右侧终端，工作过程以聊天流内步骤卡片展示；文件树移入左侧「文件」视图
- **聊天界面极简终端式**：去头像/去气泡，流式 Markdown 实时渲染，回到底部/复制/重试
- **可靠性根治**：兼容网关 `message.tool_calls`、输出上限自适应、空响应指数退避重试、流式超时自动重试、最终回复重复架构级根治、多轮记忆修复
- **风险操作软件内确认**：右下角确认卡片 + 「本次任务都批准」，原生窗口按钮
- **浏览器可交互**：browse 可访问性快照 + 6 个浏览器交互工具，每任务独立会话
- **存储与性能**：全量原子写、FTS5-lite 会话索引、缓存自动释放
- **多 Agent 协作**：dispatch 并发上限/子任务 token 预算/角色专属模型/交接开关/动态上限顺延
- **安全**：MCP 工具自动注入 + 逐工具权限、渲染沙箱 + CSP

### v0.3.2 (2026-08-06)

- Token 优化系列（注入/上下文/度量/可控四层，11 开关集中管理）+ Hermes/Codex 优点吸收 + 关于页动态版本号 + 模型读取增强 + 界面全中文化

### v0.3.1 (2026-08-05)

- 会话级并发状态重构、主进程/SettingsView/chat 拆分、安全加固（workflow 防挂起、插件 fs 白名单、构建类型门禁、日志脱敏）

### v0.3.0 (2026-08-04)

- 类型基础重构、chat 模块化拆分、Agent 实体化（白名单/能力路由）、插件执行层、工作目录自定义、视觉任务队列

### v0.2.x (2026-07-30 ~ 08-03)

- 多 Agent 协作系统、语义记忆 v2、MCP 客户端、NSIS 安装包、DPAPI 加密落盘、web_read 网页解析、GPU 渲染选项

---

## 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电·忘川守·芽衣）。出云国最后的幸存者，背负终极诏刀「忘川」的巡海游侠，主动踏入虚无的自灭者——世界于她只剩黑白灰，红色是唯一能清晰辨识的色彩，是记忆、是故人、也是她存在于此的证明。

> 「下雨了，要一起走段路吗？我带了伞。」
