# 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

一个以《崩坏：星穹铁道》角色「黄泉」为原型的 Windows 桌面 AI 助手。它不只是一个聊天窗口：能读写文件、执行命令、搜索网页、定时干活，还能调度一支由星穹铁道角色组成的 Agent 小队并行协作。技术栈是 Electron 32 + React 18 + TypeScript + Vite 5 + Zustand。

和它对话不是问答，是交付。复杂任务会被拆成看得见的执行步骤，Agent 各干各的，每一步在聊天流里实时可见。

---

## 主要功能

### 星穹列车 Agent 编队

内置 7 个 Agent，各有领域工具白名单，支持交接（handoff）和并行分发（dispatch）：

- 姬子：主控调度，负责任务分解、分发和汇总（全工具权限）
- 三月七：文档处理，分析、报告、翻译
- 银狼：安全与代码审查，查漏洞、盯风险
- 艾丝妲：任务调度与自动化，定时任务、监控、脚本
- 知更鸟：情感陪伴与日常闲聊
- 黑天鹅：视觉与设计，看图、配色、截图
- 螺丝咕姆：全栈开发，代码、项目、架构

每个 Agent 有真实的工具白名单和能力路由，子 Agent 之间上下文隔离，编队管理页可以编辑白名单并持久化。姬子可以调用 `dispatch` 把子任务分给多个 Agent 并行执行（并发上限可设，超出自动排队分批），或者用 `handoff` 交接上下文（可开关：关闭全量上下文传递 / 完成后自动交回）。子任务有独立 token 预算、角色可配置专属模型。

### 独立内核 AgentEngine（v0.3.3）

Agent 主循环迁入主进程：LLM 直连、工具分发、上下文构建、记忆、模型调度、视觉队列、子任务 dispatch 全部由引擎接管，渲染层只消费事件流。支持断点落盘恢复（应用重启后可从断点继续）、计划确认门（实验）——首次调用工具前展示执行计划，批准后才动手。

### 会话区（v0.3.4 回合制重构）

- **回合制布局**：每条用户消息与其后的助手内容合并为一个回合，消息列居中限宽，与输入框同宽
- **用户消息**：右侧玻璃圆角气泡（长文本自动收两行、悬停展开、点击编辑）；运行中仅最新一条显示停止按钮
- **助手回复**：平铺 Markdown（流式原地增长），悬停消息右下角浮现操作栏（时间、token/耗时、朗读、重新生成、复制、引用）
- **思考过程折叠块**：模型思考内容（reasoning_content）随流式实时写入并持久化，执行中自动展开、完成后收成一行，历史会话重开保留
- **工具调用**：扁平脚手架行（状态图标 + 工具名 + 参数摘要 + 耗时），点击展开参数与结果
- **输入区 Dock**：与消息列同宽的玻璃圆角卡片——上行多行输入区，下行工具条（「+ 补充更多上下文」、附件上传、圆形发送键、模型选择器胶囊、纯中文推理强度按钮「推理：快速/标准/高/极高/最高」）
- 流式输出纯文本直出（50ms 节流，结束才渲染 Markdown），「微压缩（每轮小步）」默认开启分摊压缩成本

### 浏览器（v0.3.4 内嵌实时画面）

- agent 浏览器会话与主窗口共享同一 webContents：点击「浏览器」或悬浮横幅即切到内嵌面板，顶部工具栏（后退/前进/刷新/主页/地址栏/复制/系统浏览器）+ 下方原生实时页面，可直接查看和操作
- CPU 兼容模式自动切离屏截图双引擎，不闪烁；零额外安装体积（复用 Electron 自带 Chromium）
- `browse` 工具输出可访问性快照（`@编号` 可交互元素），配合 `browser_click` / `browser_type` / `browser_press` / `browser_scroll` / `browser_console` / `browser_vision` 可真正操作网页；每任务独立浏览器会话（互不串页面）；URL 安全校验（仅 http/https）

### 50+ 内置工具

- 文件：read（分段读取，支持 >5MB 续读）、write、edit、mkdir、grep、find、ls
- 系统：exec_command（自动识别 PowerShell/cmd，可被「停止」递归打断）、system_info、process_list、kill_process
- 网络：web_search、web_fetch、browse（可访问性快照 + 交互工具）、browse_screenshot、web_read（系统 Edge 解析网页）
- 浏览器交互：browser_click / browser_type / browser_press / browser_scroll / browser_console / browser_vision
- 界面：screenshot、clipboard_read/write
- 多媒体：TTS 语音朗读（Windows 自带语音，离线可用）、read_image（自动压缩）、media_img / media_video
- 记忆：save_memory（可置顶跨 Agent 保留）、recall_memory（向量语义检索）、import_doc、session_search（会话检索）
- 沙箱：codebox（跑 Python/Node 代码）
- 定时：schedule_task、list_schedules
- MCP：mcp_connect（stdio）、mcp_call、mcp:sse（SSE 传输，跟随系统代理）；已连接服务器的工具自动注入（`mcp__服务器__工具`），逐工具权限（默认 ask）
- Agent：handoff、dispatch、list_agents
- 工作流：list_workflows、run_workflow（6 个内置模板）
- 其他：show_card、bridge_notify、audit_log、watch_file、save_goal/list_goals、set_workdir、set_theme

工具可以单独开关，有 LRU+TTL 缓存（读操作 30 秒、搜索 120 秒，写操作自动失效；缓存自动释放：文件缓存 32MB/10min 上限），每个工具还有独立的权限设置（deny / ask / full）。插件通过 index.js 协议在 vm 沙箱里运行（require 白名单、10 秒超时、4KB 输出截断），插件工具可以直接注入给 LLM 调用。

### 记忆与上下文

- 语义记忆：TF-IDF 向量化 + 余弦相似度检索，按重要度评分、每日衰减、有 Token 预算和自动遗忘上限（500 条）。v0.2.4 起嵌入引擎可配置，中文用 bigram 分词，检索更准
- 上下文管理：中英混合 Token 估算，压力大时自动分层压缩（截断 → 摘要 → 激进压缩），自动适配不同模型的窗口大小（deepseek 1M / claude 200K / qwen 262K 等）
- 多轮对话完整历史入引擎（不丢跨轮记忆），会话搜索 FTS5-lite 倒排索引（英文单词 + 中文 bigram，增量更新）

### 推理强度（v0.3.4 原生参数驱动）

- 输入框右侧「推理：档位」按钮，纯中文菜单：关闭 / 快速 / 标准 / 高 / 极高 / 最高
- 原生参数 + 提示词双轨：DeepSeek / Kimi / 智谱 / 豆包·火山 / SiliconFlow 走 thinking 开关、OpenRouter/Nous 走 reasoning{enabled,effort}、OpenAI 推理模型 / Grok / LM Studio 走 reasoning_effort，其余兼容服务由提示词兜底
- 「关闭思考」独立开关；「仅当前模型」可为单个模型单独设档（覆盖全局）

### 视觉与媒体

- 发图时自动判断：当前模型不支持视觉就自动切到可用的视觉模型（同供应商优先），支持就不切，没有可用模型会明确提示
- 视觉任务走独立队列：识图类任务强制用「视觉理解」模型；调用失败自动顺位下一个；任务完成后自动切回主力模型
- 对话里提到生图、生视频会自动调用媒体工具（策略页可关掉自动生成，改成明确要求才生成）

### 安全

- API Key、自定义 Headers、网页 Cookie 全部用 Windows DPAPI 加密落盘，不存明文
- L0-L4 风险分级：读文件 L0，普通写入 L1，终端命令 L2，系统路径写入 L3，删除和危险命令（rm -rf、format、shutdown 等黑名单）L4
- 风险操作软件内确认：确认卡片显示在输入框上方居中（拒绝/允许 + 「以后都批准」按操作类型持久化，可管理撤销 + 「本次任务都批准」新任务自动失效），60 秒无人操作自动拒绝；只读查询命令不打扰
- 文件权限四档：full / sandbox（限工作目录）/ readonly / ask
- 命令执行走 spawn + 白名单，会话 ID 白名单防路径穿越，Markdown 渲染全量转义防 XSS
- 主窗口渲染沙箱 + 页面 CSP；插件在 vm 沙箱里执行，require 白名单 + 超时 + 输出截断
- 记忆安全扫描：写入前检测 API Key/凭证/提示注入

### 其他

- 会话置顶（📌 永久保留，不受裁剪）；会话保存异步原子写，崩溃不丢数据
- 6 套主题 + 皮肤系统（背景图自动提取主色调），窗口透明度、动画、字号都可调；定时任务等副页面与系统窗口按钮全部跟随主题
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
│   │   └── tools.ts           # 主进程工具实现（51 个）
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
│   │   ├── settings/          # 16 个设置 tab（供应商/策略/角色/记忆/协作/工具/MCP/技能/外观/统计/诊断/引擎/定时任务/藏书阁/式神/关于）
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

### v0.3.4 (2026-08-06)

- **会话区回合制重构**：用户消息/助手回复/工具调用/输入区全新布局，悬停操作栏（朗读/重新生成/复制/引用），用户消息可编辑
- **浏览器内嵌实时画面**：WebContentsView 直接在主窗口显示真实网页（替代截图轮询），CPU 模式离屏双引擎
- **思考过程持久化**：reasoning_content 随流式写入会话 + 折叠块展示，历史重开保留
- **推理强度原生参数驱动**：各服务商原生 thinking/reasoning 参数 + 提示词兜底；纯中文档位菜单；「仅当前模型」覆盖
- **流式提速**：纯文本直出（50ms 节流）+ 独立子组件，聊天区不随 token 重渲染；「微压缩（每轮小步）」默认开启
- **输入框卡片式**：860px 居中圆角卡片、「+ 补充更多上下文」、附件上传、圆形发送键、胶囊模型选择器
- **风险确认增强**：确认卡片居中显示，「以后都批准」按操作类型持久化可管理
- **移除任务拆分与进度卡**：dispatch 恢复并行分批执行
- **主题一致性**：副页面与系统窗口按钮全部跟随主题
- 验证：build ✅ / vitest 全绿 ✅ / 6 主题逐一截图 ✅

### v0.3.3 (2026-08-06)

- 独立内核 AgentEngine（主循环迁入主进程、断点恢复、计划确认门）
- 工作步骤卡片（移除右侧终端，聊天流内步骤卡片 + 任务进程卡）
- 聊天界面极简终端式（流式 Markdown 实时渲染、回到底部/复制/重试、会话置顶）
- 可靠性根治（message.tool_calls 兼容、输出上限自适应、指数退避重试、流式超时、回复重复架构级根治、多轮记忆修复）
- 风险操作软件内确认 + 原生窗口按钮；浏览器 6 个交互工具 + 每任务独立会话
- 全量原子写、FTS5-lite 会话索引、缓存自动释放；MCP 工具自动注入 + 逐工具权限
- 验证：build ✅ / vitest 17 文件 95 用例 ✅

### v0.3.2 (2026-08-06)

- Token 优化系列（注入/上下文/度量/可控四层，11 开关集中管理）+ 优点吸收（记忆安全扫描/冻结快照/AGENTS.md/会话搜索/回复去重）+ 关于页动态版本号 + 模型读取增强 + 界面全中文化

### v0.3.1 (2026-08-05)

**会话修复（块 A~F）**
- 会话级并发状态模块（session-state.ts），取代全局状态，多会话并发互不串台（Agent 状态/插话队列/阶段气泡全部会话级）
- 停止/重发/自动续跑：终止只作用于当前会话（会话级任务代号 + abort 会话过滤）
- 发送幂等去重（同一内容 500ms 内重复发送忽略）
- 清空边界 / 中途保存（长任务每 30 秒自动落盘）
- 主进程保存队列：防抖合并、meta 写盘绑定、load 失败标记

**重构（块 G~N）**
- 主进程拆分：main.ts 108KB → 28KB，107 个 IPC handler 全部迁入 electron/ipc/ 18 个域文件（行为零变化、通道名零变化）
- SettingsView 拆分：165KB → 11.9KB 壳，13 个 tab 迁入 src/components/settings/
- chat.ts 拆分：51KB → 10.4KB，发送主逻辑迁入 chat-send.ts
- 94 处补丁注释清零；组件全部 ≤25KB；全库 any 清零（0 处）
- vitest 测试基座（8 个测试文件 29 个用例，`npm test` 全绿）

**补丁（安全加固 + 构建门禁）**
- workflow 工具防挂起：脚本未调用 `ctx.done` 或返回 Promise 后不 resolve 时，30 秒超时兜底 + 普通返回值自动收尾（原实现会永久卡住工具循环，stop 也救不回）
- 插件沙箱 fs 路径限制：`require('fs')` 白名单全部包一层工作目录校验，插件不能读取工作目录外的任意文件
- 构建类型门禁：`npm run build` 增加渲染层 `tsc --noEmit`（原来只查 electron 端，渲染层类型错误不会让 CI 失败）
- LLM 日志脱敏：失败日志不再输出用户消息内容（只保留 role/工具结构）；`[LLM]` 调试日志收敛到 `HQ_LLM_DEBUG` 环境变量
- 记忆安全扫描：保存记忆时检测 API Key / 授权头 / JWT 等 7 类敏感模式与 4 类 prompt 注入特征，命中即拒绝落盘
- 插话队列补丁 M1~M4（有界合并/改向熔断/发送锁/序列断言）此前已并入本版

### v0.3.0 (2026-08-04)

- 类型基础重构：types.ts 成为全库统一类型来源，tsc --noEmit（strict + noImplicitAny）纳入构建门禁，历史约 90 条类型错误清零
- chat.ts 模块化拆分：主模块 + context / memory / router / subtask / runtime 六个模块
- Agent 实体化：7 位 Agent 有真实工具白名单与能力路由，子 Agent 上下文隔离，编队管理页白名单可编辑、可持久化
- 插件执行层：index.js 协议 + vm 沙箱（require 白名单、10s 超时、4KB 输出截断）+ 权限 ask 确认，插件工具注入 LLM
- 全局 any 清零：显式 any 全库移除，错误信息统一提取
- 工作目录自定义：exec_command 执行目录跟随设置，新路径自动创建；设置页改完文件树立即刷新（不再靠 5s 轮询）；「◎」气泡一键切换工作目录
- 供应商面板：点击供应商自动预填默认 BaseURL / API 类型（只填空字段），切换供应商前自动保存当前配置
- 图片需求自动切换：发图时模型不支持视觉则自动切到可用视觉模型（同供应商优先），无可用模型则提示
- 媒体自动生成：对话中遇到生图/生视频需求自动调用 media_img / media_video 工具，策略页可关闭自动生成
- 视觉任务强制队列：识图任务强制走「视觉理解」模型，失败自动顺位切换，任务完成自动切回主力模型
- 图片调度修复（FIX-A~G）：9 种图片格式直读视觉链路、拖入图统一压缩（≤1568px / ≤1.5MB）、HEIC 转换提示、模型还原 finally 全覆盖、视觉误判兜底

### v0.2.4 (2026-08-03)

- RAG embedding 升级：嵌入引擎可配置，TF-IDF 退役
- 中文 bigram 向量分词，语义检索更准
- 情景记忆写盘防抖，memory 异步写入
- 自动更新：启动时检查 GitHub Releases 新版本并提示
- 设置页新增「关于」章节（版本信息、软件更新独立 tab）
- 新增 CI 构建工作流（.github/workflows/build.yml，推 tag 自动打包发布）
- 危险命令拦截增强、skills 路径白名单
- 历史截断保留摘要、插话队列会话归属、Promise 错误不再刷屏

### v0.2.3 (2026-08-02)

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
- 时间戳置于 prompt 绝对末尾，缓存前缀稳定
- 崩溃日志异步追加；清理主进程双 Agent 体系与 planner/workflow 死代码（6 文件）

**安装包修复（0.2.3）**
- 修复安装版启动崩溃：skillsDir 移至 userData（原指向 app.asar 内目录，mkdir 抛 ENOTDIR 导致主窗口不创建）
- 修复 exe/快捷方式图标：移除 signAndEditExecutable:false（会跳过 exe 资源编辑）+ 多尺寸 icon.ico

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
- settings.json 大字段剥离至 bgimage.dat（背景图与配置分离，避免每次保存全量写大文件）
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

## 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电·忘川守·芽衣）。出云国最后的幸存者，背负终极诏刀「忘川」的巡海游侠，主动踏入虚无的自灭者——世界于她只剩黑白灰，红色是唯一能清晰辨识的色彩，是记忆、是故人、也是她存在于此的证明。

> 「下雨了，要一起走段路吗？我带了伞。」
