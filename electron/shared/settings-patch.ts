// electron/shared/settings-patch.ts — 聊天改设置的白名单校验与脱敏(纯函数, 可单测)
// 目的: 自然语言可以调节"所有安全可改的设置", 但密钥/风险开关/超大字段必须走设置页, 防止提示注入与密钥进上下文。

const STRING_KEYS = new Set(['theme', 'mode', 'agentName', 'language', 'region', 'showTimestamps', 'customSystemPrompt', 'promptInjectPos', 'thinkLevel', 'sp', 'ishiki', 'mainModel', 'fastModel', 'longTextModel', 'codeModel', 'mediaImgProvider', 'mediaVideoProvider', 'browserHomeUrl', 'compactStrategy', 'workDir', 'skinSecondary'])
const BOOL_KEYS = new Set(['autoFastModel', 'autoMediaImg', 'autoMediaVideo', 'mcpAutoConnectOnStart', 'mcpAutoReconnect', 'autoCopy', 'useTables', 'useLists', 'useEmoji', 'expressUncertainty', 'askWhenMissing', 'showConfidence', 'explainRefusal', 'neutralOnControversial', 'noClosingPhrase', 'briefClosing', 'notifyTaskDone', 'notifyError', 'keepUserGoals', 'keepPendingTasks', 'keepDecisions', 'keepRecentRaw', 'taskArchive', 'animation'])
const NUMBER_KEYS = new Set(['uiFontSize', 'codeFontSize', 'chatMaxWidth', 'opacity', 'mcpTimeout', 'compactMsgCount', 'compactTokenLimit', 'compactStrength', 'ragChunkSize', 'ragThreshold'])
const OBJECT_KEYS = new Set(['thinkOverrides', 'toolPerms', 'perf', 'customColors', 'customTheme', 'skinColors', 'uiDisplay', 'pluginSettings'])

// 明确不允许经对话修改: 密钥/凭证、风险放行、命令黑名单、MCP 服务器命令、插件权限、代理与 GPU 等安全或主进程私有项
const BLOCKED_KEYS = new Set(['filePermission', 'riskConfirm', 'riskAutoApprove', 'riskAlwaysAllow', 'dangerCommandExtra', 'mcpServers', 'pluginStates', 'pluginPerm', 'bgImage', 'embeddingBaseUrl', 'embeddingModel', 'embeddingApiKey', 'webReadCookies', 'proxyMode', 'proxyUrl', 'rendererMode'])

export interface PatchResult { ok: boolean; problems: string[]; value: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function validGeneralEntry(k: string, v: unknown): { ok: boolean; problem?: string; value?: unknown } {
  if (STRING_KEYS.has(k)) {
    if (typeof v !== 'string') return { ok: false, problem: k + ' 必须是字符串' }
    const cap = k === 'sp' || k === 'customSystemPrompt' ? 20000 : k === 'ishiki' ? 60000 : 2000
    return { ok: true, value: v.slice(0, cap) }
  }
  if (BOOL_KEYS.has(k)) return typeof v === 'boolean' ? { ok: true, value: v } : { ok: false, problem: k + ' 必须是布尔值' }
  if (NUMBER_KEYS.has(k)) return typeof v === 'number' && Number.isFinite(v) ? { ok: true, value: v } : { ok: false, problem: k + ' 必须是数字' }
  if (OBJECT_KEYS.has(k)) {
    if (!isObj(v)) return { ok: false, problem: k + ' 必须是对象' }
    if (k === 'toolPerms') {
      for (const [tk, tv] of Object.entries(v)) if (!['allow', 'deny', 'ask'].includes(String(tv))) return { ok: false, problem: 'toolPerms 取值仅 allow/deny/ask (' + tk + ')' }
    }
    if (k === 'perf') {
      for (const [pk, pv] of Object.entries(v)) if (typeof pv !== 'boolean') return { ok: false, problem: 'perf.' + pk + ' 必须是布尔值' }
    }
    if (k === 'thinkOverrides') {
      for (const [mk, mv] of Object.entries(v)) if (typeof mv !== 'string') return { ok: false, problem: 'thinkOverrides.' + mk + ' 必须是字符串' }
    }
    if (k === 'uiDisplay' && v.customCss !== undefined && typeof v.customCss !== 'string') return { ok: false, problem: 'uiDisplay.customCss 必须是字符串' }
    if (k === 'uiDisplay' && v.statusLine !== undefined && typeof v.statusLine !== 'string') return { ok: false, problem: 'uiDisplay.statusLine 必须是字符串' }
    if (k === 'pluginSettings') {
      for (const [pk, pv] of Object.entries(v)) {
        if (!isObj(pv)) return { ok: false, problem: 'pluginSettings.' + pk + ' 必须是对象' }
        for (const [sk, sv] of Object.entries(pv)) {
          if (typeof sv !== 'string' && typeof sv !== 'number' && typeof sv !== 'boolean') return { ok: false, problem: 'pluginSettings.' + pk + '.' + sk + ' 仅支持字符串/数字/布尔' }
        }
      }
    }
    return { ok: true, value: v }
  }
  if (BLOCKED_KEYS.has(k)) return { ok: false, problem: k + ' 不允许通过对话修改(密钥/安全相关, 请在设置页操作)' }
  return { ok: false, problem: '未知设置字段: ' + k }
}

export function sanitizeGeneralPatch(patch: unknown): PatchResult {
  if (!isObj(patch)) return { ok: false, problems: ['补丁必须是对象'], value: {} }
  const value: Record<string, unknown> = {}
  const problems: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    const r = validGeneralEntry(k, v)
    if (r.ok && r.value !== undefined) value[k] = r.value
    else problems.push(r.problem || '无效字段')
  }
  return { ok: problems.length === 0, problems, value }
}

// 供应商/多媒体: 仅允许非密钥字段; 密钥字段保持磁盘原值(DPAPI 密文), 绝不回写
export function sanitizeProvidersPatch(patch: unknown, section: 'providers' | 'mediaProviders'): PatchResult {
  if (!Array.isArray(patch)) return { ok: false, problems: [section + ' 补丁必须是数组'], value: {} }
  const problems: string[] = []
  const out: unknown[] = []
  const allowed = section === 'providers'
    ? ['id', 'name', 'type', 'baseUrl', 'models', 'selectedModel', 'enabled']
    : ['id', 'name', 'baseUrl', 'imgModels', 'videoModels', 'selectedImg', 'selectedVideo', 'enabled']
  const STRING_FIELDS = new Set(['name', 'type', 'baseUrl', 'selectedModel', 'selectedImg', 'selectedVideo'])
  const ARRAY_FIELDS = new Set(['models', 'imgModels', 'videoModels'])
  for (const item of patch) {
    if (!isObj(item) || typeof item.id !== 'string' || !item.id) { problems.push('每一项必须含字符串 id'); continue }
    const cleaned: Record<string, unknown> = { id: item.id }
    for (const [k, v] of Object.entries(item)) {
      if (!allowed.includes(k)) { problems.push('provider 字段不允许经对话修改: ' + k); continue }
      if (STRING_FIELDS.has(k) && typeof v !== 'string') { problems.push(k + ' 必须是字符串'); continue }
      if (ARRAY_FIELDS.has(k) && (!Array.isArray(v) || !v.every(x => typeof x === 'string'))) { problems.push(k + ' 必须是字符串数组'); continue }
      if (k === 'enabled' && typeof v !== 'boolean') { problems.push('enabled 必须是布尔值'); continue }
      cleaned[k] = v
    }
    out.push(cleaned)
  }
  return { ok: problems.length === 0, problems, value: { list: out } }
}

// 读取设置时的脱敏: 密钥/凭证/超大字段绝不进入模型上下文
export function redactSettings(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(redactSettings)
  if (!isObj(data)) return data
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k === 'apiKey' || k === 'customHeaders' || k === 'headers' || k === 'embeddingApiKey' || k === 'webReadCookies') { out[k] = v ? '***' : undefined; continue }
    if (k === 'bgImage') continue
    if (k === 'pluginSettings' && isObj(v)) {
      const ps: Record<string, unknown> = {}
      for (const [pk, pv] of Object.entries(v)) {
        if (!isObj(pv)) { ps[pk] = pv; continue }
        const masked: Record<string, unknown> = {}
        for (const [sk, sv] of Object.entries(pv)) masked[sk] = /key|token|secret|password|passwd/i.test(sk) ? '***' : sv
        ps[pk] = masked
      }
      out[k] = ps
      continue
    }
    out[k] = redactSettings(v)
  }
  return out
}
