// electron/shared/settings-types.ts —— 设置类型唯一来源(渲染层与主进程引擎共用)
// 目的: 消除 GeneralSettings(渲染层) / EngineSettings(引擎) 双份定义的手动同步风险
// 引擎用 EngineSettings extends GeneralSettings; 渲染层从本文件直接取 GeneralSettings

export interface AgentDef {
  role: string
  prompt: string
  tools: string[] // 真实白名单; '*' = 全工具(仅姬子/螺丝咕姆可配)
  handoff_to: string[]
  icon: string
  model?: string // 模型偏好(v0.4 网关接入, 先落字段)
  memoryScope: string
  capabilities: string[] // ['dispatch','doc','security','automation','chat','vision','code']
}

export interface GeneralSettings {
  theme: string
  language?: string
  mode?: string
  workDir?: string
  filePermission?: string // full | sandbox | readonly | ask | auto
  collabMode?: string
  disabledAgents?: string[]
  maxHandoffChain?: number
  opacity?: number
  animation?: boolean
  customColors?: { bg?: string; surface?: string; card?: string; accent?: string; text?: string; border?: string }
  chatPersona?: string
  workPersona?: string
  bgImage?: string
  bgOpacity?: number
  skinColors?: { r: number; g: number; b: number }
  notifyEnabled?: boolean
  episodicMemory?: boolean
  meltdownLimit?: number
  compactThreshold?: number
  compactKeepRounds?: number
  compactTokenCap?: number
  compactOverrides?: Record<string, number>
  maxToolRounds?: number
  retryCount?: number
  parallelTools?: boolean
  toolTimeout?: number
  autoCleanCache?: boolean        // 自动清理 Chromium 缓存(默认开启)
  autoCleanCacheSize?: number     // 触发阈值 MB(默认 200)
  cardMaxHeight?: number
  singleBubble?: boolean
  disabledTools?: string[]
  // 工具级权限表(deny/ask/full): 并入设置存储, 取代 localStorage 明文
  toolPerms?: Record<string, string>
  // v0.3.4: 风险确认「以后都批准」—— 按操作类型持久化放行(执行命令/写入文件/删除)
  riskAlwaysAllow?: string[]
  // v0.3.3 内核加固: 风险操作确认/任务 token 预算/诊断轨迹/MCP 自动注入
  riskConfirm?: boolean       // 默认开: L2/L3 终端与删除操作弹原生确认
  riskAutoApprove?: boolean   // v0.3.6: 永久放行全部风险操作(开启后 L2/L3 不再弹确认)
  longTaskAutoContinue?: boolean // v0.3.7: 长任务预算耗尽后自动继续(重置已用量续跑)
  longTaskAutoMax?: number    // v0.3.7: 自动继续次数上限, 超过后结束本轮
  maxTaskTokens?: number      // 单任务 token 预算, 0=不限
  maxConcurrentTasks?: number // v0.3.8: 同时运行的任务上限(多会话并发保护), 默认 3
  hooksText?: string           // v0.3.8: 事件钩子(每行 事件=命令)
  hiddenSkills?: string[]      // 自省整改: 内置技能隐藏名单(资源技能不可删, 只能隐藏)
  dangerCommandExtra?: string[] // 自省整改: 危险命令黑名单扩展(额外子串, 命中即 L4 拦截)
  projectDocMaxKb?: number     // v0.3.8: 项目指令合并注入上限(KB, 默认 32), 超限截断并打标记
  traceEnabled?: boolean      // 默认开: 本地诊断轨迹
  mcpAutoInject?: boolean     // 默认开: MCP 工具 schema 自动并入 LLM
  planGate?: boolean          // 实验: 首次工具调用前展示计划等用户批准(独立内核)
  llmSummary?: boolean        // 实验: 上下文压缩用 LLM 摘要(独立内核)
  microCompact?: boolean      // 微压缩: 每轮把最旧一轮问答折进运行摘要, 分摊压缩成本(默认开)
  autoSave?: boolean
  maxSessions?: number
  temperature?: number
  maxTokens?: number
  logLevel?: string
  devTools?: boolean
  ragChunkSize?: number
  ragThreshold?: number
  ragAutoSave?: boolean
  ttsEnabled?: boolean
  ttsRate?: number
  // 调度绑定(所有模型公用, 含自定义模型)
  smallModel?: string
  largeModel?: string
  // 皮肤系统(与主题解耦)
  skinMask?: string
  skinSecondary?: string
  themePreset?: string
  // v0.3.0 M3: 角色覆盖(AgentsView 白名单/模型偏好/记忆范围编辑)
  agentOverrides?: Record<string, Partial<AgentDef>>
  // +: 运行期字段(人设/皮肤/浏览器/记忆/提示词注入等)
  rolePreset?: string
  browserFloatEnabled?: boolean
  browserFloatPos?: string
  webReadEnabled?: boolean
  webReadHeadless?: boolean
  webReadTimeout?: number
  webReadUA?: string
  webReadProxy?: string
  webReadAutoClose?: boolean
  webReadCleanAds?: boolean
  webReadCookies?: string
  rendererMode?: string
  autoMemoryEnabled?: boolean
  notifyTaskDone?: boolean
  notifyError?: boolean
  customSystemPrompt?: string
  promptInjectPos?: string
  thinkLevel?: string
  thinkOverrides?: Record<string, string>
  sp?: string
  ishiki?: string
  autoFastModel?: boolean
  fastModel?: string
  longTextModel?: string
  codeModel?: string
  mainModel?: string
  region?: string
  keepUserGoals?: boolean
  keepPendingTasks?: boolean
  keepDecisions?: boolean
  keepRecentRaw?: boolean
  stat_cacheRate?: string
  stat_cacheHits?: number
  stat_cacheMisses?: number
  useTables?: boolean
  useLists?: boolean
  useEmoji?: boolean
  autoCopy?: boolean
  expressUncertainty?: boolean
  askWhenMissing?: boolean
  showConfidence?: boolean
  explainRefusal?: boolean
  neutralOnControversial?: boolean
  noClosingPhrase?: boolean
  briefClosing?: boolean
  // v0.3.0 M5: 补全运行期字段(代码实际访问, 之前宽类型逃逸)
  pluginPerm?: Record<string, string>
  browserHomeUrl?: string
  browserWinW?: number
  browserWinH?: number
  browserSnapMs?: number
  browserFloatTimeout?: number
  compactStrategy?: string
  compactMsgCount?: number
  compactTokenLimit?: number
  compactStrength?: number
  customTheme?: { bg?: string; surface?: string; card?: string; accent?: string; text?: string; border?: string }
  mcpAutoConnectOnStart?: boolean
  mcpAutoReconnect?: boolean
  mcpTimeout?: number
  autoMediaImg?: boolean
  autoMediaVideo?: boolean
  // v0.3.3 T3: 跨任务归档开关(默认开启, 0.3.5 并入性能开关区)
  taskArchive?: boolean
  // v0.3.5 T2: token 优化系列统一开关(默认全开, 单点可回退; undefined 视为 true)
  perf?: {
    toolWhitelist?: boolean  // 0.3.2 T1 工具白名单注入
    resultSlim?: boolean     // 0.3.2 T3 结果瘦身 1500
    memoryTrim?: boolean     // 0.3.2 T4 记忆裁剪
    workflowLazy?: boolean   // 0.3.2 T5 workflows 按需
    outputCap?: boolean      // 0.3.2 T7 输出上限分级
    imgDowngrade?: boolean   // 0.3.3 T1 图片降级
    argSlim?: boolean        // 0.3.3 T2 参数截断
    taskArchive?: boolean    // 0.3.3 T3 跨任务归档(迁移: perf.taskArchive ?? 旧 taskArchive 字段)
    parallelCap?: boolean    // 0.3.5 T1 并行护栏
    interjectMerge?: boolean // 0.3.4 T3 插话合并
    compactSummary?: boolean // 窗口阈值压缩（真实用量触发 + LLM 批量摘要）
    toolCore?: boolean        // 0.3.8: 主控核心工具模式(默认开), 关闭后恢复全量工具
  }
  mediaImgProvider?: string
  mediaImgModel?: string
  mediaImgMode?: string
  mediaImgRatio?: string
  mediaImgConcurrency?: number
  mediaVideoProvider?: string
  mediaVideoModel?: string
  mediaVideoMode?: string
  mediaVideoDuration?: number
  mediaAudioProvider?: string
  mediaAudioModel?: string
  proxyMode?: string
  proxyUrl?: string
  outputFormat?: string
  exportFormat?: string
  knowledgeFrom?: string
  knowledgeTo?: string
  knowledgeTimeLimit?: boolean
  knowledgeWhitelist?: boolean
  autoSkill?: boolean
  skillMinSteps?: number
  visionAutoSwitch?: boolean
  visionModel?: string
  visionModels?: string[]
  embeddingApiKey?: string
  embeddingBaseUrl?: string
  embeddingModel?: string
  programMemory?: boolean
  shortTermMemory?: boolean
  episodicRetention?: string
  episodicRollback?: boolean
  handoffAutoReturn?: boolean
  handoffContext?: boolean
  maxAgents?: number
  sessionEndAction?: string
  strictVersionAware?: boolean
  trayEnabled?: boolean
  uiFontSize?: number
  addressStyle?: string
  agentName?: string
  chatMaxWidth?: number
  codeFontSize?: number
  commentLang?: string
  connectTimeout?: number
  crossValidation?: boolean
  cvMode?: string
  cvCodeReview?: boolean
  cvSecurity?: boolean
  cvFinancial?: boolean
  cvConflictAction?: string
  linkStyle?: string
  mathRender?: string // katex | mathjax | plain | none
  messageSpacing?: string
  showTimestamps?: string // always | hover | never
  toneStyle?: string
  userAlias?: string
  verbosity?: number
}
