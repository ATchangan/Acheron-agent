# 0.3.0 (2026-08-04)
- 类型基座: types.ts 单一类型来源, 全量 tsc --noEmit 纳入构建门槛(历史 ~90 条类型错误清零, strict + noImplicitAny)
- chat.ts 模块化拆分: 壳 + context/memory/router/subtask/runtime 六模块
- Agent 实体化: 7 位 Agent 真实工具白名单与能力路由, 子 Agent 上下文隔离, Agent 编队管理页(白名单可编辑/持久化)
- 插件执行层: index.js 协议 + vm 沙箱(require 白名单/10s 超时/4KB 截断) + 权限 ask 确认, 插件工具注入 LLM
- 全局 any 清零: 显式 any 全库移除, errMsg 统一错误提取
- 主题 token 校验挂入 npm run build 前置检查
- 工作目录自定义修复: exec_command 执行目录跟随设置(设置→引擎→工作目录), 新路径自动创建目录
- 供应商面板: 点击左侧供应商自动加载默认 BaseURL/API 类型(仅空字段), 切换供应商前自动保存当前配置
- 工作目录实时生效: 设置页修改工作目录后, 聊天右侧文件树立即刷新(不依赖 5s 轮询)
- 工作目录「⋯」气泡: 设置→引擎与右侧面板均可点三点按钮, 点一次即弹出(可选默认工作台/浏览目录或直接输入, 输入框自动聚焦), 文件树实时跟随
- 图片需求自动切换: 发图时当前模型不支持视觉则自动切换到可用视觉模型(同供应商优先), 支持则不切换, 无可用模型则提示
- 媒体自动生成: 对话中遇到生图/生视频需求自动调用 media_img/media_video 工具(无需用户明确要求), 生图走 OpenAI 兼容 images API, 生视频走 CLI 适配器; 策略页新增「自动生图/自动生视频」开关(默认开启, 关闭后需明确要求才生成)
- 视觉任务强制队列: 识图任务强制优先【视觉理解】队列模型(策略页优先级), 禁止纯文本模型处理图像; 调用失败自动顺位下一个, 全部失败清晰报错; 视觉候选排除绘图模型(能力校验); 失效模型标记「已失效」; [MODEL] 日志输出调度选择
- 视觉任务完整流程(先定模型→再喂图→后出结果→最后切回): 内容判定视觉任务(看图/识别图片/分析图像)强制切队列视觉模型; 任务完成自动切回主力模型恢复日常对话
- 图片调度修复方案(FIX-A~G): 路径直读接入视觉链路(computer:readFileAsDataUrl, 9 格式直接可用); 拖入图统一压缩 normalizeImage(≤1568px/≤1.5MB, 透明保 PNG, 降级链); 9 格式归一化矩阵(HEIC 明确转换提示); 模型还原统一 finally+switchedVision(正常/异常/中断全覆盖); analyzeWithVision 部分成功; buildVisionCandidates 单一候选来源(ref 兼容); 视觉误判兜底(无图无路径不切模型)

## 0.2.5 (2026-08-04)
# 0.2.5 (2026-08-04)
- 主题 token 体系化: 6 套预设主题(dark/light/black/huangquan/bloodmoon/dawn)统一 18 项 token, 新增一致性校验脚本 scripts/check-theme-tokens.mjs
- 黄泉主题深度重做: 虚无黑 × 血泪红 × 虚无紫, 气泡血泪描边/品牌字红紫渐变/滚动条与辉光皮肤化
- 新增血月 bloodmoon(暗红夜护眼)与晨曦 dawn(浅色暖调)两套主题
- 皮肤系统升级: 双主色 K-means 提取(主色+辅色)、遮罩三档(亮/中/暗)、与主题彻底解耦(皮肤不再覆盖强调色)
- 主题设置 UI: 卡片式预览(色点+选中描边)、自定义取色器实时预览(背景/卡片/强调/文字)、皮肤遮罩档位与辅色重提取
- 硬编码颜色清零: ui-polish.css 与组件状态色收敛为语义 token(129 处), 浮窗/遮罩走 token
- 旧 themePreset 主题自动迁移到新 6 套体系

## 0.2.4 (2026-08-03)
- RAG embedding 升级(嵌入引擎配置, TF-IDF 回退)
- 自动更新(GitHub Releases 检查/下载)
- CI 构建工作流(.github/workflows/build.yml)
- 设置页新增「关于」章节(版本/软件更新独立 tab)
- 危险命令拦截 / skills 路径白名单 / memory 异步写
- 插话队列会话归属 / 情景记忆写盘防抖 / 中文 bigram 向量分词
- 历史截断保留摘要 / 本地技能原生文件选择 / Promise 错误不再刷页面

## v0.2.3 (2026-08-01)

### 安全
- 修复命令注入: skills/plugins 安装改用 spawn + 白名单校验
- 修复技能预览 XSS: renderMarkdown 全量转义 + 协议白名单
- 修复会话路径穿越: 会话 id 白名单校验
- workflow 工具加固: 限长 8KB + 严格模式
- mkdir 走 IPC(工作目录校验), 不再拼 shell
- abort 按 requestId 精确中止(多会话并发互不误杀)
- sandbox 权限路径规范化(防 .. 穿越)
- API Key / customHeaders / webReadCookies 经 DPAPI(safeStorage)加密落盘
- 每工具权限表(ToolsView)接入 runTool, deny/ask 生效

### 修复
- read 工具 offset/limit 透传主进程分段读(>5MB 续读)
- grep/find 异步化(fs.promises)+ glob 转义修复 + 扩展名正则修复
- recall_memory 接入向量语义检索 + 关键词合并
- ishiki 独立存储(不再从 sp 反推)
- 会话元数据缓存(避免 list 全量解析大会话)
- costedReqs 防无限增长; 工具缓存 hash 用 JSON 序列化
- 单实例退出不再抛异常; 死代码块清理
- MCP SSE 改用 net.fetch(跟随系统代理)
- MemoryView 增删记忆 try-catch; FloatBadge 实时读设置; Sidebar 删除会话加确认
- 删除主进程双 Agent 体系与 planner/workflow 死代码(6 文件)

### 性能
- 时间戳置于 prompt 绝对末尾(缓存前缀稳定, 命中率 13%→30%+)
# 黄泉Agent 完整交付报告

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
