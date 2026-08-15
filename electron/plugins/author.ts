// electron/plugins/author.ts — 自写插件核心(v0.4.x 自研能力)
// Agent 通过 install_plugin 工具生成插件, 校验后落入 plugins/<name>/, 无需重启即注入下一轮工具列表。
// 安全基线:
//   - 代码仅做静态加载校验(不执行 run), 校验沙箱无 fs/process, 顶层只允许 require('path')
//   - 运行时沙箱(ipc/plugins.ts) 与校验共用 createHardenedContext: 阻断 eval/Function 字符串代码生成, 堵住经典 vm 逃逸
//   - 插件名/工具名白名单正则 + 大小上限, 目录路径不可穿越
import * as fs from 'fs'
import { join, sep } from 'path'
import { getPluginImplTools } from './loader'
import { loadPluginToolsStatic } from './sandbox'
import type { EngineToolSpec } from '../engine/types'
import type { PluginSettingDef } from '../shared/settings-types'

export interface PluginToolMeta { name: string; description: string; params: Record<string, string> }
export interface PluginValidation { ok: boolean; problems: string[]; tools: PluginToolMeta[] }
export interface PluginInstallResult { ok: boolean; error?: string; name: string; version: string; tools: PluginToolMeta[]; path: string }
export interface PluginDetail { name: string; version: string; description: string; selfWritten: boolean; hasImpl: boolean; tools: string[] }

export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-_]{0,79}$/
export const PLUGIN_TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/
export const PLUGIN_CODE_MAX = 64 * 1024
export const PLUGIN_DESC_MAX = 500
export const PLUGIN_TOOLS_MAX = 20
export const PLUGIN_PARAMS_MAX = 12
export const PLUGIN_SELF_AUTHOR = 'self'
export const PLUGIN_SETTINGS_MAX = 20
export const PLUGIN_SETTING_KEY_RE = /^[a-zA-Z0-9_-]{1,64}$/

// 向后兼容: 运行时沙箱入口统一收敛在 sandbox.ts
export { createHardenedContext } from './sandbox'

function addProblem(problems: string[], p: string): void { problems.push(p) }

// ─── 静态校验: 只读 module.exports.tools 元数据, 绝不执行 run ───
export function validatePluginCode(name: string, description: string, code: string): PluginValidation {
  const problems: string[] = []
  const tools: PluginToolMeta[] = []
  if (!PLUGIN_NAME_RE.test(name)) addProblem(problems, '插件名非法: 仅允许小写字母/数字开头, 1-80 位字母数字-_')
  if (!description.trim()) addProblem(problems, 'need description')
  else if (description.length > PLUGIN_DESC_MAX) addProblem(problems, 'description 超过 ' + PLUGIN_DESC_MAX + ' 字符')
  if (!code.trim()) addProblem(problems, 'need code')
  else if (Buffer.byteLength(code, 'utf-8') > PLUGIN_CODE_MAX) addProblem(problems, '代码超过 ' + (PLUGIN_CODE_MAX / 1024) + 'KB 上限')
  if (problems.length) return { ok: false, problems, tools }

  let list: unknown[] = []
  try {
    list = loadPluginToolsStatic(code)
  } catch (e: unknown) {
    addProblem(problems, '代码加载失败: ' + (e instanceof Error ? e.message : String(e)))
  }
  if (problems.length === 0) {
    if (list.length === 0) addProblem(problems, 'module.exports.tools 必须是非空数组')
    else {
      if (list.length > PLUGIN_TOOLS_MAX) addProblem(problems, '工具数量超过 ' + PLUGIN_TOOLS_MAX + ' 上限')
      const seen = new Set<string>()
      for (const t of list) {
        if (!t || typeof t !== 'object') { addProblem(problems, '工具项必须为对象'); continue }
        const toolName = String((t as { name?: unknown }).name || '').trim()
        const desc = String((t as { description?: unknown }).description || '').trim()
        const rawParams = (t as { params?: unknown }).params
        const run = (t as { run?: unknown }).run
        if (!PLUGIN_TOOL_NAME_RE.test(toolName) || toolName.includes('__')) { addProblem(problems, '工具名非法: ' + JSON.stringify(toolName) + ' (仅 1-64 位字母数字_- 且不含 __)'); continue }
        if (seen.has(toolName)) { addProblem(problems, '工具名重复: ' + toolName); continue }
        seen.add(toolName)
        if (!desc) addProblem(problems, '工具 ' + toolName + ' 缺少 description')
        else if (desc.length > PLUGIN_DESC_MAX) addProblem(problems, '工具 ' + toolName + ' description 超长')
        if (typeof run !== 'function') addProblem(problems, '工具 ' + toolName + ' 缺少 run(args, ctx) 函数')
        const params: Record<string, string> = {}
        if (rawParams !== undefined && rawParams !== null) {
          if (typeof rawParams !== 'object' || Array.isArray(rawParams)) addProblem(problems, '工具 ' + toolName + ' params 必须是对象')
          else {
            const keys = Object.keys(rawParams as Record<string, unknown>)
            if (keys.length > PLUGIN_PARAMS_MAX) addProblem(problems, '工具 ' + toolName + ' 参数超过 ' + PLUGIN_PARAMS_MAX + ' 个')
            for (const k of keys) {
              const v = (rawParams as Record<string, unknown>)[k]
              if (typeof v !== 'string' || !v.trim()) addProblem(problems, '工具 ' + toolName + ' 参数 ' + k + ' 必须是非空类型字符串(string/number/boolean/array/object)')
              else params[k] = v
            }
          }
        }
        tools.push({ name: toolName, description: desc, params })
      }
    }
  }
  return { ok: problems.length === 0, problems, tools }
}

// ─── 插件设置 schema 校验(manifest.settings) ───
export function validatePluginSettings(settings: unknown): { ok: boolean; problems: string[]; defs: PluginSettingDef[] } {
  const problems: string[] = []
  const defs: PluginSettingDef[] = []
  if (settings === undefined || settings === null) return { ok: true, problems, defs }
  if (!Array.isArray(settings)) return { ok: false, problems: ['settings 必须是数组'], defs }
  if (settings.length > PLUGIN_SETTINGS_MAX) problems.push('设置项超过 ' + PLUGIN_SETTINGS_MAX + ' 上限')
  const seen = new Set<string>()
  for (const s of settings) {
    if (!s || typeof s !== 'object') { problems.push('设置项必须是对象'); continue }
    const key = String((s as { key?: unknown }).key || '').trim()
    const label = String((s as { label?: unknown }).label || '').trim()
    const type = String((s as { type?: unknown }).type || 'string')
    const rawDef = (s as { default?: unknown; options?: unknown; hint?: unknown }).default
    const options = (s as { options?: unknown }).options
    const hint = (s as { hint?: unknown }).hint
    if (!PLUGIN_SETTING_KEY_RE.test(key) || seen.has(key)) { problems.push('设置 key 非法或重复: ' + key); continue }
    seen.add(key)
    if (!label || label.length > 100) problems.push('设置项 ' + key + ' label 非法(1-100 字)')
    if (!['string', 'number', 'boolean', 'select'].includes(type)) { problems.push('设置项 ' + key + ' type 仅支持 string/number/boolean/select'); continue }
    if (rawDef !== undefined) {
      if (type === 'string' && typeof rawDef !== 'string') problems.push(key + ' default 必须是字符串')
      if (type === 'number' && typeof rawDef !== 'number') problems.push(key + ' default 必须是数字')
      if (type === 'boolean' && typeof rawDef !== 'boolean') problems.push(key + ' default 必须是布尔')
    }
    if (type === 'select' && (!Array.isArray(options) || options.length === 0 || !options.every(o => typeof o === 'string' && o))) problems.push(key + ' select 必须提供非空 options 字符串数组')
    if (hint !== undefined && typeof hint !== 'string') problems.push(key + ' hint 必须是字符串')
    defs.push({ key, label, type: type as PluginSettingDef['type'], default: rawDef as PluginSettingDef['default'], options: Array.isArray(options) ? options : undefined, hint: typeof hint === 'string' ? hint.slice(0, 300) : undefined })
  }
  return { ok: problems.length === 0, problems, defs }
}

// ─── 安装: manifest.json 自动生成, 版本号覆盖时自动 +1 ───
export function installPlugin(pluginsDir: string, name: string, description: string, code: string, overwrite: boolean, settings?: PluginSettingDef[]): PluginInstallResult {
  const v = validatePluginCode(name, description, code)
  if (!v.ok) return { ok: false, error: '插件校验失败:\n- ' + v.problems.join('\n- '), name, version: '', tools: [], path: '' }
  const sv = validatePluginSettings(settings)
  if (!sv.ok) return { ok: false, error: '插件设置 schema 校验失败:\n- ' + sv.problems.join('\n- '), name, version: '', tools: [], path: '' }
  const dir = join(pluginsDir, name)
  let version = '1.0.0'
  try {
    if (fs.existsSync(join(dir, 'manifest.json'))) {
      if (!overwrite) return { ok: false, error: '插件已存在: ' + name + '（覆盖更新请传 overwrite=true）', name, version: '', tools: [], path: dir }
      const prev = JSON.parse(fs.readFileSync(join(dir, 'manifest.json'), 'utf-8'))
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(prev?.version || ''))
      if (m) version = m[1] + '.' + m[2] + '.' + (Number(m[3]) + 1)
    }
  } catch { /* 读取旧清单失败按全新安装处理 */ }
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(join(dir, 'index.js'), code, 'utf-8')
    const manifest = {
      name, version, description, author: PLUGIN_SELF_AUTHOR, license: 'MIT', category: 'oni',
      tools: v.tools.map(t => ({ name: t.name, description: t.description, params: t.params })),
      ...(sv.defs.length ? { settings: sv.defs } : {}),
    }
    fs.writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    bustPluginCache(pluginsDir, name)
    return { ok: true, name, version, tools: v.tools, path: dir }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), name, version: '', tools: [], path: dir }
  }
}

export function removePlugin(pluginsDir: string, name: string): { ok: boolean; error?: string } {
  if (!PLUGIN_NAME_RE.test(name)) return { ok: false, error: '插件名非法' }
  const dir = join(pluginsDir, name)
  try {
    if (!fs.existsSync(dir)) return { ok: false, error: '插件不存在: ' + name }
    bustPluginCache(pluginsDir, name)
    fs.rmSync(dir, { recursive: true, force: true })
    return { ok: true }
  } catch (e: unknown) { return { ok: false, error: e instanceof Error ? e.message : String(e) } }
}

export function readPluginSource(pluginsDir: string, name: string): string {
  if (!PLUGIN_NAME_RE.test(name)) return 'E:插件名非法'
  const dir = join(pluginsDir, name)
  try {
    const mf = fs.existsSync(join(dir, 'manifest.json')) ? fs.readFileSync(join(dir, 'manifest.json'), 'utf-8') : '(无 manifest.json)'
    const code = fs.existsSync(join(dir, 'index.js')) ? fs.readFileSync(join(dir, 'index.js'), 'utf-8') : '(无 index.js 实现)'
    const head = '## manifest.json\n' + mf.slice(0, 4000) + (mf.length > 4000 ? '\n...[截断]' : '')
    const tail = '\n\n## index.js\n' + code.slice(0, 24000) + (code.length > 24000 ? '\n...[截断, 共 ' + code.length + ' 字符]' : '')
    return head + tail
  } catch (e: unknown) { return 'E:' + (e instanceof Error ? e.message : String(e)) }
}

export function listPluginDetails(pluginsDir: string): PluginDetail[] {
  const out: PluginDetail[] = []
  try {
    if (!fs.existsSync(pluginsDir)) return out
    const implTools = getPluginImplTools(pluginsDir) || []
    for (const entry of fs.readdirSync(pluginsDir)) {
      const dir = join(pluginsDir, entry)
      const mf = join(dir, 'manifest.json')
      if (!fs.existsSync(mf)) continue
      try {
        const m = JSON.parse(fs.readFileSync(mf, 'utf-8'))
        out.push({
          name: String(m?.name || entry),
          version: String(m?.version || 'unknown'),
          description: String(m?.description || '').slice(0, 200),
          selfWritten: m?.author === PLUGIN_SELF_AUTHOR,
          hasImpl: fs.existsSync(join(dir, 'index.js')),
          tools: implTools.filter(t => t.plugin === entry).map(t => t.name),
        })
      } catch { /* 损坏清单跳过 */ }
    }
  } catch { /* 目录不存在 */ }
  return out
}

// ─── require 缓存失效: 让覆盖更新/删除后, 元数据立即读取新代码 ───
export function bustPluginCache(pluginsDir: string, name: string): void {
  const base = join(pluginsDir, name)
  for (const key of Object.keys(require.cache)) {
    if (key === join(base, 'index.js') || key.startsWith(base + sep)) delete require.cache[key]
  }
}

// 全部插件 require 缓存失效: reload_plugins 手动改文件后调用, 让元数据立即读新代码
export function bustAllPluginCaches(pluginsDir: string): void {
  try {
    if (!fs.existsSync(pluginsDir)) return
    for (const entry of fs.readdirSync(pluginsDir)) bustPluginCache(pluginsDir, entry)
  } catch { /* 目录不存在或不可读: 忽略 */ }
}

// ─── 插件启用状态(settings.json → general.pluginStates) ───
export function readPluginStates(settingsPath: string): Record<string, { enabled?: boolean; category?: string }> {
  try {
    const g = (JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { general?: Record<string, unknown> })?.general
    if (g && typeof g.pluginStates === 'object' && g.pluginStates && !Array.isArray(g.pluginStates)) {
      return g.pluginStates as Record<string, { enabled?: boolean; category?: string }>
    }
  } catch { /* 设置缺失/损坏时视为全部启用 */ }
  return {}
}

export function isPluginDisabled(settingsPath: string, name: string): boolean {
  const st = readPluginStates(settingsPath)[name]
  return !!st && st.enabled === false
}

// ─── 插件工具 schema 注入(与 MCP 同款缓存, 15s) ───
let specCache: { dir: string; at: number; specs: EngineToolSpec[] } | null = null
export function invalidatePluginToolSpecCache(): void { specCache = null }

export function getPluginToolSpecs(pluginsDir: string, force = false, settingsPath?: string): EngineToolSpec[] {
  if (!force && specCache && specCache.dir === pluginsDir && Date.now() - specCache.at < 15000) return specCache.specs
  const specs: EngineToolSpec[] = []
  const states = settingsPath ? readPluginStates(settingsPath) : {}
  const disabled = new Set(Object.keys(states).filter(k => states[k].enabled === false))
  try {
    for (const t of getPluginImplTools(pluginsDir) || []) {
      if (!PLUGIN_TOOL_NAME_RE.test(t.name) || t.name.includes('__')) continue
      if (disabled.has(t.plugin)) continue
      const props: Record<string, { type: string; description?: string }> = {}
      for (const [k, v] of Object.entries(t.params || {})) {
        const vt = String(v || 'string')
        props[k] = { type: ['string', 'number', 'boolean', 'array', 'object'].includes(vt) ? vt : 'string', description: k }
      }
      specs.push({
        type: 'function',
        function: {
          name: 'plugin_' + t.plugin + '__' + t.name,
          description: String(t.description || ('插件工具 ' + t.plugin + '/' + t.name)).slice(0, 200),
          parameters: { type: 'object', properties: props, required: [] },
        },
      })
    }
  } catch { /* 插件目录损坏时返回空 */ }
  specCache = { dir: pluginsDir, at: Date.now(), specs }
  return specs
}
