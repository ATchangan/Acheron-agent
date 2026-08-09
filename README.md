# 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

一个以《崩坏：星穹铁道》角色「黄泉」为原型的 Windows 桌面 AI 助手。它不只是一个聊天窗口：能读写文件、执行命令、搜索网页、定时干活，还能调度一支由星穹铁道角色组成的 Agent 小队并行协作。技术栈是 Electron 32 + React 18 + TypeScript + Vite 5 + Zustand。

和它对话不是问答，是交付。复杂任务会被拆成看得见的执行步骤，Agent 各干各的，每一步在聊天流里实时可见。

![黄泉Agent 主界面](docs/screenshot-home.png)

---

## 主要功能

### Agent 编队

内置 7 个 Agent（姬子主控、三月七文档、银狼安全、艾丝妲调度、知更鸟陪伴、黑天鹅视觉、螺丝咕姆开发），各有领域工具白名单，支持交接（handoff）和并行分发（dispatch）。子 Agent 上下文隔离，子任务有独立 token 预算、角色可配专属模型，并发上限可设（超出自动排队）。

### 独立内核 AgentEngine

Agent 主循环运行在主进程：LLM 直连、工具分发、上下文/记忆/模型调度/子任务全部由引擎接管，渲染层只消费事件流。支持断点落盘恢复、计划确认门（实验，批准后才动手）。

### 一键环境自检

设置 → 诊断 提供「一键环境自检」：一次性检测 PowerShell 7、Windows PowerShell、cmd、工作目录、用户数据/会话/回滚目录、API 供应商与网络连通、磁盘/内存、技能、插件、浏览器内核、渲染模式、记忆文件、代理、Git、MCP、本地服务等 21 项，全部只读，异常项直接给出解决建议。

### 计划执行与验证闭环

复杂任务自动生成执行计划：每个工具调用对应一个步骤，计划卡实时打勾、可折叠、点击跳转执行记录；模型可用 `update_plan` 自主声明/更新计划。任务收尾自动生成执行计划复盘（完成/失败/未执行明细），每个任务自动落盘 PLANS.md（Goal / Progress / Surprises & Discoveries / Decision Log / Outcomes），断点恢复后继续维护。

修改文件后未运行验证命令时，引擎会自动注入验证请求（最多 1 轮，控制效率成本）并记入决策日志；`write` 后用 `read` 确认即视为验证通过。

简单任务不会要求模型先调用 `update_plan` 声明计划（工具调用会自动生成步骤卡），复杂任务或你明确要求计划时才会走计划声明，减少无效轮次。

### 项目指令（AGENTS.md）与执行机制

- **项目指令自动发现**：任务开始时自动读取工作目录的项目指令，文件名优先级 `AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md` > `.agents.md`；git 仓库内按「根目录 → 工作目录」逐层合并，深层规则优先；不在 git 仓库时只看工作目录。合并上限默认 32 KiB（设置 → 引擎 → 项目指令上限可调），超限自动截断并打标记，不再静默丢内容
- **子目录按需注入**：模型读取某个子目录的文件时，自动把该目录（上溯最多 5 层）的项目规则附加到工具结果，每会话每目录只注入一次，单文件 8k 上限；支持在文件头部写 `paths` 作用域（YAML frontmatter，如 `src/**`、`*.ts`），只对匹配路径生效
- **注入安全扫描**：所有项目指令注入前扫描提示注入模式，可疑文件直接跳过
- **一键生成项目指令**：模型可调用 `init_project_docs` 扫描工作目录生成 AGENTS.md 草稿（项目概览 / 常用命令 / 目录结构 / 默认约定），已存在时不覆盖
- **事件钩子（Hooks）**：设置 → 引擎 可配 `事件=命令` 钩子，支持 tool-before / tool-after / task-start / task-end / file-write / task-stop / task-resume / compact-before / model-fallback，注入 `HQ_EVENT/HQ_TOOL/HQ_SID/HQ_TASK_ID/HQ_RESULT/HQ_PATH/HQ_STATUS` 等环境变量；含中文路径/输出的命令自动走 PowerShell（UTF-8）
- **任务文件回滚**：引擎在写操作前记录原内容，任务结束后聊天页出现「回滚文件改动」横幅，一键恢复任务开始前的状态（≤50 个文件，单文件 >5MB 跳过）
- **Windows 命令纪律**：PowerShell 7（pwsh）优先，其次 Windows PowerShell，纯 ASCII 简单命令才走 cmd；交互终端、Hooks、内部脚本统一同一套检测
- **自定义子代理**：`%APPDATA%\huangquan-agent\agents\*.json` 放 `{"名称":{role,prompt,tools,model?}}` 即注册自定义角色

### 会话区

- 回合制布局：用户消息（右侧气泡，可编辑）与助手回复（平铺 Markdown，流式原地增长）合并为回合，居中限宽
- 助手消息悬停浮现操作栏：朗读 / 重新生成 / 复制 / 引用
- 思考过程折叠块：模型思考内容实时写入并持久化，可展开查看
- 输入区玻璃 Dock：补充上下文、附件上传、模型选择、纯中文推理强度（关闭/快速/标准/高/极高/最高）

### 浏览器

浏览器面板内嵌主窗口实时画面（WebContentsView，100% 同步，可操作），CPU 模式自动降级离屏截图。`browse` 输出可访问性快照，配合 `browser_click` / `browser_type` / `browser_press` / `browser_scroll` / `browser_console` / `browser_vision` 可真正操作网页；每任务独立浏览器会话。

### 59 个内置工具

主控角色默认启用「核心工具模式」（约 28 个常用工具：文件/命令/Git/终端/网络/技能/计划/记忆/协作），每轮上下文更小、响应更快；进阶工具（截图、浏览器操作、定时、媒体等）可在 设置→工具 单独放行，或关闭核心工具模式恢复全量 59 个。

- 文件：read（>5MB 续读）、write、edit、apply_patch（多 hunk 结构化编辑）、mkdir、grep、find、ls
- 系统：exec_command（可被「停止」递归打断）、terminal_open/run/close（长驻交互终端）、system_info、process_list、kill_process
- 网络：web_search、web_fetch、browse、browse_screenshot、web_read
- 多媒体：TTS 语音朗读（离线可用）、read_image、media_img / media_video
- 记忆：save_memory、recall_memory（向量检索）、import_doc、session_search
- 计划与目标：update_plan、save_goal / list_goals、watch_file、audit_log
- 技能：read_skill（按需读取已装载技能全文与 scripts/references）
- 浏览器交互：browser_click / browser_type / browser_press / browser_scroll / browser_console / browser_vision
- 沙箱：codebox；定时：schedule_task、list_schedules
- MCP：mcp_connect / mcp_call / mcp:sse，已连接服务器工具自动注入（默认 ask 权限）
- Agent：handoff / dispatch / list_agents；工作流：list_workflows / run_workflow（6 模板）
- 其他：screenshot、clipboard_read/write、set_workdir、set_theme、show_card、bridge_notify、workflow

工具可单独开关，有 LRU+TTL 缓存（自动释放），每个工具有独立权限（deny / ask / full）。插件在 vm 沙箱运行（require 白名单、10s 超时、4KB 截断）。

### 记忆与上下文

- 语义记忆：向量化检索 + 重要度评分 + 衰减遗忘 + Token 预算
- 上下文管理：Token 估算 + 分层压缩，自动适配模型窗口大小；接近窗口上限时由模型自动总结最旧轮次（窗口阈值压缩，保留最近 N 轮，可调）
- 多轮历史完整入引擎；会话搜索 FTS5 索引

### Token 优化（0.3.2 ~ 0.3.5 系列）

全部优化集中在「设置 → 引擎 → 流量与性能」，**11 个开关默认全开，可单点关闭回退**，关闭只影响注入量、不改变执行逻辑。

| 开关 | 版本 | 作用 | 省什么 |
|---|---|---|---|
| 按任务精简工具 | 0.3.2 | 工具白名单注入 | 工具 schema |
| 长内容精简 | 0.3.2 | 结果 >1500 字符保留头尾+关键行 | 工具结果 |
| 记忆按需取用 | 0.3.2 | 只取相关记忆 | 记忆注入 |
| 工作流按需显示 | 0.3.2 | 提到工作流才注入模板 | 提示词 |
| 旧步骤自动折叠 | 0.3.2 | 较早工具步骤合并摘要 | 历史轮次 |
| 简短回复限长 | 0.3.2 | 简单闲聊输出 ≤800 | 输出 token |
| 旧图片不重复发送 | 0.3.3 | 历史图片只发一次 | 图片 token |
| 长参数精简 | 0.3.3 | 过长工具参数只留关键 | 参数 token |
| 任务记录自动归档 | 0.3.3 | 完成任务归档 | 长期上下文 |
| 并行结果精简 | 0.3.5 | 并行结果 >4 且 >6000 字符时护栏 | 下一轮重发 |
| 连续插话合并 | 0.3.4 | 补充指令合并一条 | 重复轮次 |

关键参数：结果瘦身 1500 字符（头 800 + 尾 500 + 关键行）；轮次折叠 8 对；并行护栏 6000 字符 / 保留 4 个全量；闲聊输出上限 800；估算系数按模型实测校准（0.3~3 限幅，EMA 平滑）。

缓存友好约定：system prompt 前缀稳定（思考要求/时间戳置尾）；切换 Agent 时提示词前缀失效属正常；工具列表顺序固定以保证缓存命中。

基准入口：`docs/token-baseline-report.md`（9 任务基准集，0.3.0 vs 0.3.5，含收益与智力门禁双报告）。

### 推理强度

原生参数驱动：DeepSeek/Kimi/智谱/豆包/SiliconFlow 走 thinking、OpenRouter 走 reasoning、OpenAI 推理模型/Grok/LM Studio 走 reasoning_effort，其余提示词兜底。支持「关闭思考」与「仅当前模型」档位。

### 视觉与媒体

发图自动切换到视觉模型（同供应商优先）；视觉任务走独立队列（失败自动顺位切换）；生图/生视频自动调用媒体工具（可关闭）。

### 安全

- API Key / Headers / Cookie 全部 DPAPI 加密落盘
- L0-L4 风险分级 + 危险命令黑名单
- 风险操作软件内确认卡片（「以后都批准」按类型持久化、「本次任务都批准」新任务失效、60s 自动拒绝）
- 文件权限四档；渲染沙箱 + CSP；插件沙箱；记忆写入安全扫描

### 其他

- 会话置顶（不受裁剪）；原子写落盘，崩溃不丢数据
- 6 套主题 + 皮肤系统；全界面中文化；定时任务 / 藏书阁 / 式神插件
- 自动更新（检查 GitHub Releases）；工作目录自定义；诊断轨迹（纯本地）
- 聊天/工作双模式，人设可编辑
- 安装过程默认展开详情面板（解压/写入/快捷方式实时可见）；更新下载显示文件名、百分比、速度与剩余时间

---

## 快速开始

### 安装

从 [Releases](https://github.com/ATchangan/Acheron-agent/releases) 下载 `Acheron-agent-x.x.x.exe`，双击安装（NSIS 安装包，可选目录、桌面快捷方式），支持覆盖升级，旧数据不丢。

### 首次配置

1. 「设置 → 供应商」添加 LLM 服务商，填 API Key（DPAPI 加密保存）
2. 「策略」页指定不同任务的模型，不配就全自动
3. 直接开始聊，默认黄泉人设

安装后是全新空白配置。你的数据只存在本机（`%APPDATA%\huangquan-agent`），安装包和仓库里都没有任何人的私密信息。

### 从源码构建

```bash
npm install
npm run build
npm run package:win   # NSIS 安装包
```

> 重装依赖后执行一次安装详情补丁（安装进度条旁显示解压细节）：
> `powershell -ExecutionPolicy Bypass -File scripts\patch-nsis-install-details.ps1`

---

## 更新日志

### v0.3.8 (2026-08-10)
- 执行机制：原生 `git` 工具、Hooks 9 类事件、任务文件一键回滚、自定义子代理、模型失败自动降级
- PowerShell 7 全场景路由（PATH / 已知路径 / Windows PowerShell 回退），GBK 解码修复乱码，危险命令黑名单收窄
- 效率优化：系统提示精简、`update_plan` 按需、验证 1 轮、主控核心工具模式；同任务耗时 61.6s → 5.1s
- 一键环境自检：21 项只读检测 + 解决建议；用户消息支持重新生成回复

### v0.3.7 (2026-08-09)
- 计划执行 + 验证闭环：任务自动拆解为可见步骤，收尾生成复盘，落盘 PLANS.md
- 技能生态：SKILL.md 技能清单 + read_skill，兼容市面技能包；新增 apply_patch / 会话化终端
- 安装与更新体验：安装详情面板默认展开，下载进度显示速度/剩余时间

### v0.3.6 (2026-08-08)
- 流式渲染与事件传输优化、设置页懒加载、轮询收敛

### v0.3.5 (2026-08-07)
- Token 优化收官：11 开关单点回退、上下文压缩升级为 LLM 摘要驱动

### v0.3.4 (2026-08-06)
- 会话区回合制重构、浏览器面板内嵌实时画面、思考过程持久化

### v0.3.3 (2026-08-06)
- 独立内核 AgentEngine、工作步骤卡片、可靠性根治、浏览器可交互

### v0.3.2 (2026-08-06)
- Token 优化系列、记忆安全扫描、界面全中文化

### v0.3.1 (2026-08-05)
- 会话级并发重构、主进程/设置/聊天逻辑拆分、安全加固

### v0.3.0 (2026-08-04)
- 类型基础重构、Agent 实体化、插件执行层

### v0.2.4 (2026-08-03)
- 语义检索升级、自动更新、CI 构建工作流

### v0.2.3 (2026-08-02)
- DPAPI 加密落盘、TTS 语音朗读、安装版崩溃与图标修复

### v0.2.2 (2026-08-01)
- web_read 网页解析、GPU 渲染选项、改为 NSIS 安装包

### v0.2.1 (2026-08-01)
- 全局崩溃恢复、星穹铁道角色 Agent 编队

### v0.2.0 (2026-07-30)
- 多 Agent 协作、语义记忆 v2、MCP 客户端

### v0.1.0 (2026-07-29)
- 初始发布：多 Provider LLM、20+ 工具、代码沙箱

---

## 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电·忘川守·芽衣）。出云国最后的幸存者，背负终极诏刀「忘川」的巡海游侠，主动踏入虚无的自灭者——世界于她只剩黑白灰，红色是唯一能清晰辨识的色彩，是记忆、是故人、也是她存在于此的证明。

> 「下雨了，要一起走段路吗？我带了伞。」
