// src/types.ts —— 全库类型唯一来源(v0.3.0 M1)
// 职责: 核心数据结构定义。禁止在别处重复定义同名 interface。
// 迁移自 global.d.ts 的 GeneralSettings + 方案新增 ToolSpec/AgentDef/SubTaskCtx

export interface ToolParam {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParam
  properties?: Record<string, ToolParam>
  required?: string[]
}

export interface ToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: { type: 'object'; properties: Record<string, ToolParam>; required?: string[] }
  }
}

export interface ToolResult {
  ok: boolean
  data?: string
  error?: string
  truncated?: boolean
}

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

export interface SubTaskCtx {
  task: string
  agent: string
  parentSid: string
  context: string // 只含任务必要上下文, 不复制全局会话
}

// v0.3.0 M1: GeneralSettings 从 global.d.ts 迁移, 字段全量类型化
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
  agentAvatar?: string
  agentAvatarImage?: string
  notifyEnabled?: boolean
  episodicMemory?: boolean
  meltdownLimit?: number
  compactThreshold?: number
  maxToolRounds?: number
  retryCount?: number
  parallelTools?: boolean
  toolTimeout?: number
  cardMaxHeight?: number
  singleBubble?: boolean
  disabledTools?: string[]
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
  // v0.2.4: 调度绑定(所有模型公用, 含自定义模型)
  smallModel?: string
  largeModel?: string
  // v0.2.5: 皮肤系统(与主题解耦)
  skinMask?: string
  skinSecondary?: string
  themePreset?: string
  // v0.3.0 M3: Agent 覆盖(AgentsView 白名单/模型偏好/记忆范围编辑)
  agentOverrides?: Record<string, Partial<AgentDef>>
  // v0.2.5+: 运行期字段(人设/皮肤/浏览器/记忆/提示词注入等)
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
