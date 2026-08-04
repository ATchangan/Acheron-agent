# 黄泉Agent · Acheron-agent

> 「即便万事终归于虚无，有些事，即便没有意义，也依然值得去做。」

一个以《崩坏：星穹铁道》角色「黄泉」为原型的 Windows 桌面 AI 助手。它不只是一个聊天窗口：能读写文件、执行命令、搜索网页、定时干活，还能调度一支由星穹铁道角色组成的 Agent 小队并行协作。技术栈是 Electron 32 + React 18 + TypeScript + Vite 5 + Zustand。

和它对话不是问答，是交付。复杂任务会被拆成看得见的执行计划，Agent 各干各的，工具调用的过程在界面上实时可见。

---

## 主要功能

### 星穹列车 Agent 编队

内置 7 个 Agent，都有完整工具权限，支持交接（handoff）和并行分发（dispatch）：

- 姬子：主控调度，负责任务分解、分发和汇总
- 三月七：文档处理，分析、报告、翻译
- 银狼：安全与代码审查，查漏洞、盯风险
- 艾丝妲：任务调度与自动化，定时任务、监控、脚本
- 知更鸟：情感陪伴与日常闲聊
- 黑天鹅：视觉与设计，看图、配色、截图
- 螺丝咕姆：全栈开发，代码、项目、架构

v0.3.0 起每个 Agent 有真实的工具白名单和能力路由，子 Agent 之间上下文隔离，编队管理页可以编辑白名单并持久化。姬子可以调用 `dispatch` 把子任务分给多个 Agent 并行执行，或者用 `handoff` 交接上下文。

### 40+ 内置工具

- 文件：read（分段读取，支持 >5MB 续读）、write、edit、mkdir、grep、find、ls
- 系统：exec_command（自动识别 PowerShell/cmd）、system_info、process_list、kill_process
- 网络：web_search、web_fetch、browse（无头浏览器取全文）、browse_screenshot、web_read（系统 Edge 解析网页）
- 界面：screenshot、clipboard_read/write
- 多媒体：TTS 语音朗读（Windows 自带语音，离线可用）、read_image（自动压缩）
- 记忆：save_memory（可置顶跨 Agent 保留）、recall_memory（向量语义检索）、import_doc
- 沙箱：codebox（跑 Python/Node 代码）
- 定时：schedule_task、list_schedules
- MCP：mcp_connect（stdio）、mcp_call、mcp:sse（SSE 传输，跟随系统代理）
- Agent：handoff、dispatch、list_agents
- 工作流：list_workflows、run_workflow（6 个内置模板）
- 其他：show_card、bridge_notify、audit_log、watch_file、save_goal/list_goals、set_workdir、set_theme

工具可以单独开关，有 LRU+TTL 缓存（读操作 30 秒、搜索 120 秒，写操作自动失效），每个工具还有独立的权限设置（deny / ask / full）。v0.3.0 新增插件执行层：插件通过 index.js 协议在 vm 沙箱里运行（require 白名单、10 秒超时、4KB 输出截断），插件工具可以直接注入给 LLM 调用。

### 记忆与上下文

- 语义记忆：TF-IDF 向量化 + 余弦相似度检索，按重要度评分、每日衰减、有 Token 预算和自动遗忘上限（500 条）。v0.2.4 起嵌入引擎可配置，中文用 bigram 分词，检索更准
- 上下文管理：中英混合 Token 估算，压力大时自动分层压缩（截断 → 摘要 → 激进压缩），自动适配不同模型的窗口大小（deepseek 1M / claude 200K / qwen 262K 等）

### 视觉与媒体

- 发图时自动判断：当前模型不支持视觉就自动切到可用的视觉模型（同供应商优先），支持就不切，没有可用模型会明确提示
- 视觉任务走独立队列：识图类任务强制用「视觉理解」模型，不用纯文本模型硬看；调用失败自动顺位下一个，全部失败会给清晰报错；任务完成后自动切回主力模型
- 对话里提到生图、生视频会自动调用媒体工具（策略页可关掉自动生成，改成明确要求才生成）

### 安全

- API Key、自定义 Headers、网页 Cookie 全部用 Windows DPAPI 加密落盘，不存明文
- L0-L4 风险分级：读文件 L0，普通写入 L1，终端命令 L2，系统路径写入 L3，删除和危险命令（rm -rf、format、shutdown 等黑名单）L4
- 文件权限四档：full / sandbox（限工作目录）/ readonly / ask
- 命令执行走 spawn + 白名单，会话 ID 白名单防路径穿越，Markdown 渲染全量转义防 XSS
- 插件在 vm 沙箱里执行，require 白名单 + 超时 + 输出截断

### 其他

- 独立浏览器窗口 + 悬浮提示，agent 浏览网页时你可以实时看到它在看什么
- 6 套主题 + 皮肤系统（背景图自动提取主色调），窗口透明度、动画、字号都可调
- 聊天/工作双模式，两种人设（黄泉完整人设 / 高效执行人设）都可以自己编辑
- 自动更新：启动时检查 GitHub Releases，有新版本会提示
- 工作目录可以自定义，改完聊天右侧的文件树立即刷新；设置页和右侧面板都能快速切换工作目录
- GPU 渲染自动识别（auto/gpu/cpu），流式渲染 40ms 节流，会话异步写盘

---

## 项目结构

```
Acheron-agent/
├── electron/                  # Electron 主进程
│   ├── main.ts                # 窗口/托盘/生命周期(28KB,IPC 已拆分出去)
│   ├── ipc/                   # 107 个 IPC handler,18 个域文件
│   ├── preload.ts             # contextBridge 安全桥
│   ├── webtools.ts            # 网页解析(playwright-core + 系统 Edge)
│   ├── mcp/                   # MCP 客户端(stdio + SSE)
│   ├── memory/vector.ts       # 语义记忆(向量检索/衰减/预算)
│   ├── scheduler/cron.ts      # 定时任务
│   ├── security/permission.ts # L0-L4 风险分级
│   ├── cache/                 # 工具结果缓存 + 模型缓存统计
│   └── plugins/loader.ts      # 插件加载(vm 沙箱执行层)
├── src/                       # React 渲染进程
│   ├── store/
│   │   ├── chat.ts            # 工具实现 + Agent 编队 + 权限检查
│   │   ├── chat-send.ts       # 发送主逻辑
│   │   ├── session-state.ts   # 会话级并发状态(多会话互不串台)
│   │   └── settings.ts        # 人设/主题/供应商设置
│   ├── types.ts               # 全库统一类型来源(tsc strict 门禁)
│   ├── components/
│   │   ├── settings/          # 13 个设置 tab(拆分自 SettingsView)
│   │   └── ...                # 聊天/文件树/浏览器/悬浮窗等界面
├── resources/
│   ├── skills/                # 4 组内置技能
│   └── ishiki.md              # 黄泉人格定义
├── docs/                      # 自检报告与开发文档
├── scripts/                   # 构建门禁脚本(主题 token 检查等)
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

## 更新日志

### v0.3.1 (2026-08-04)

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
- vitest 测试基座(8 个测试文件 29 个用例,`npm test` 全绿)

**补丁（安全加固 + 构建门禁）**
- workflow 工具防挂起：脚本未调用 `ctx.done` 或返回 Promise 后不 resolve 时，30 秒超时兜底 + 普通返回值自动收尾（原实现会永久卡住工具循环，stop 也救不回）
- 插件沙箱 fs 路径限制：`require('fs')` 白名单全部包一层工作目录校验，插件不能读取工作目录外的任意文件（与弹窗文案「仅限工作目录」一致）
- 构建类型门禁：`npm run build` 增加渲染层 `tsc --noEmit`（原来只查 electron 端，渲染层类型错误不会让 CI 失败）
- LLM 日志脱敏：失败日志不再输出用户消息内容（只保留 role/工具结构）；`[LLM]` 调试日志收敛到 `HQ_LLM_DEBUG` 环境变量
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

## 人格原型

人格定义取材于《崩坏：星穹铁道》角色「黄泉」（Acheron / 雷电·忘川守·芽衣）。出云国最后的幸存者，背负终极诏刀「忘川」的巡海游侠，主动踏入虚无的自灭者——世界于她只剩黑白灰，红色是唯一能清晰辨识的色彩，是记忆、是故人、也是她存在于此的证明。

> 「下雨了，要一起走段路吗？我带了伞。」

---

## 许可

Apache-2.0
