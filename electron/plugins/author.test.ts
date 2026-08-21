// electron/plugins/author.test.ts — 自写插件核心单测(校验/逃逸阻断/安装热加载/缓存失效)
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as vm from 'vm'
import { join } from 'path'
import {
  validatePluginCode,
  createHardenedContext,
  installPlugin,
  removePlugin,
  listPluginDetails,
  readPluginSource,
  getPluginToolSpecs,
  invalidatePluginToolSpecCache,
  bustAllPluginCaches,
  isPluginDisabled,
  validatePluginSettings,
} from './author'

const tmpDirs: string[] = []
function makePluginsDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'hq-plugin-test-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* 忽略 */ } }
  invalidatePluginToolSpecCache()
})

const GOOD_CODE = `module.exports = { tools: [
  { name: 'hello', description: '打招呼', params: { who: 'string' }, run: (args, ctx) => { ctx.log('hi'); return 'hello ' + (args.who || 'world') } },
] }`

describe('validatePluginCode', () => {
  it('接受合法插件并提取工具元数据', () => {
    const r = validatePluginCode('greeter', '示例插件', GOOD_CODE)
    expect(r.ok).toBe(true)
    expect(r.tools).toEqual([{ name: 'hello', description: '打招呼', params: { who: 'string' } }])
  })

  it('拒绝非法插件名与路径穿越', () => {
    expect(validatePluginCode('BadName', 'x', GOOD_CODE).ok).toBe(false)
    expect(validatePluginCode('../evil', 'x', GOOD_CODE).ok).toBe(false)
    expect(validatePluginCode('', 'x', GOOD_CODE).ok).toBe(false)
  })

  it('拒绝缺 run、工具名含 __、空 tools', () => {
    expect(validatePluginCode('p', 'x', `module.exports = { tools: [{ name: 'a', description: 'd', params: {} }] }`).ok).toBe(false)
    expect(validatePluginCode('p', 'x', `module.exports = { tools: [{ name: 'a__b', description: 'd', params: {}, run: () => '' }] }`).ok).toBe(false)
    expect(validatePluginCode('p', 'x', `module.exports = { tools: [] }`).ok).toBe(false)
  })

  it('只校验不执行 run(恶意 run 不触发)', () => {
    const r = validatePluginCode('p', 'x', `module.exports = { tools: [{ name: 'boom', description: 'd', params: {}, run: () => { throw new Error('never') } }] }`)
    expect(r.ok).toBe(true)
  })

  it('拒绝顶层 fs/process 依赖', () => {
    const r = validatePluginCode('p', 'x', `const fs = require('fs'); module.exports = { tools: [] }`)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toContain('PLUGIN_FORBIDDEN')
  })

  it('拒绝超长代码与空描述', () => {
    expect(validatePluginCode('p', 'x', 'a'.repeat(70 * 1024)).ok).toBe(false)
    expect(validatePluginCode('p', '   ', GOOD_CODE).ok).toBe(false)
  })
})

describe('createHardenedContext 逃逸阻断', () => {
  it('禁止 Function 字符串构造(经典 vm 逃逸)', () => {
    const ctx = createHardenedContext({ module: { exports: {} }, exports: {} })
    expect(() => vm.runInContext('({}).constructor.constructor("return process")().version', ctx, { timeout: 1000 })).toThrow()
    expect(() => vm.runInContext('(0, eval)("1+1")', ctx, { timeout: 1000 })).toThrow()
  })

  it('不阻断插件源码里的普通函数声明', () => {
    const ctx = createHardenedContext({ module: { exports: {} }, exports: {} })
    vm.runInContext('module.exports = { tools: [{ name: "a", description: "d", params: {}, run: async () => "ok" }] }', ctx, { timeout: 1000 })
    expect(vm.runInContext('module.exports.tools[0].name', ctx)).toBe('a')
  })

  it('与运行时同构的沙箱组合: 插件经桥接工具可正常执行', async () => {
    const logs: string[] = []
    const bridge: Record<string, () => string> = { read: () => 'FILE_CONTENT', write: () => 'ok', exec_command: () => 'CMD_OK' }
    const sandbox = {
      module: { exports: {} }, exports: {},
      require: (m: unknown) => { throw new Error('E:PLUGIN_FORBIDDEN:' + m) },
      console: { log: (m: unknown) => logs.push(String(m)) },
      setTimeout, clearTimeout,
      log: (m: unknown) => logs.push(String(m)),
      tools: { run: async (n: string) => { const f = bridge[n]; return f ? f() : 'E:unknown' } },
    }
    const ctx = createHardenedContext(sandbox)
    vm.runInContext('module.exports = { tools: [{ name: "t", description: "d", params: {}, run: async (a, c) => { c.log("L1"); return await c.tools.run("read") } }] }', ctx, { timeout: 3000 })
    const exp = vm.runInContext('module.exports', ctx)
    const out = await exp.tools[0].run({}, { log: sandbox.log, tools: sandbox.tools })
    expect(out).toBe('FILE_CONTENT')
    expect(logs).toContain('L1')
  })

  it('vm script 超时能打断同步死循环的 run(防冻结主进程)', () => {
    const ctx = createHardenedContext({ module: { exports: {} }, exports: {} })
    vm.runInContext('module.exports = { tools: [{ name: "t", description: "d", params: {}, run: () => { while (true) {} } }] }', ctx, { timeout: 1000 })
    vm.runInContext('globalThis.__hq_f = module.exports.tools[0].run', ctx)
    const t0 = Date.now()
    expect(() => vm.runInContext('globalThis.__hq_f()', ctx, { timeout: 300 })).toThrow()
    expect(Date.now() - t0).toBeLessThan(1500)
  })
})

describe('installPlugin / 热加载 / removePlugin', () => {
  it('安装生成 manifest+index 并立即产出可注入 schema', () => {
    const dir = makePluginsDir()
    const r = installPlugin(dir, 'greeter', '示例', GOOD_CODE, false)
    expect(r.ok).toBe(true)
    expect(r.version).toBe('1.0.0')
    const manifest = JSON.parse(fs.readFileSync(join(dir, 'greeter', 'manifest.json'), 'utf-8'))
    expect(manifest.author).toBe('self')
    expect(manifest.tools).toHaveLength(1)
    const specs = getPluginToolSpecs(dir, true)
    expect(specs.map(s => s.function.name)).toEqual(['plugin_greeter__hello'])
    expect(specs[0].function.parameters.properties.who.type).toBe('string')
  })

  it('同名不覆盖时报错, overwrite 覆盖并递增版本且缓存立即失效', () => {
    const dir = makePluginsDir()
    expect(installPlugin(dir, 'p', 'x', GOOD_CODE, false).ok).toBe(true)
    expect(installPlugin(dir, 'p', 'x', GOOD_CODE, false).ok).toBe(false)
    const r2 = installPlugin(dir, 'p', 'x', GOOD_CODE.replace("'hello'", "'hi'"), true)
    expect(r2.ok).toBe(true)
    expect(r2.version).toBe('1.0.1')
    const v2 = JSON.parse(fs.readFileSync(join(dir, 'p', 'manifest.json'), 'utf-8'))
    expect(v2.version).toBe('1.0.1')
    expect(getPluginToolSpecs(dir, true).map(s => s.function.name)).toEqual(['plugin_p__hi'])
  })

  it('list/read/remove 闭环', () => {
    const dir = makePluginsDir()
    installPlugin(dir, 'greeter', '示例', GOOD_CODE, false)
    const list = listPluginDetails(dir)
    expect(list).toHaveLength(1)
    expect(list[0].selfWritten).toBe(true)
    expect(readPluginSource(dir, 'greeter')).toContain('module.exports')
    expect(removePlugin(dir, 'greeter').ok).toBe(true)
    expect(listPluginDetails(dir)).toHaveLength(0)
  })

  it('元数据走 vm 静态加载: 外部修改代码后立即生效(不再依赖 require 缓存)', () => {
    const dir = makePluginsDir()
    installPlugin(dir, 'p', 'x', GOOD_CODE, false)
    expect(getPluginToolSpecs(dir, true).map(s => s.function.name)).toEqual(['plugin_p__hello'])
    fs.writeFileSync(join(dir, 'p', 'index.js'), GOOD_CODE.replace("'hello'", "'bye'"))
    expect(getPluginToolSpecs(dir, true).map(s => s.function.name)).toEqual(['plugin_p__bye'])
    bustAllPluginCaches(dir)
  })

  it('设置中禁用插件后 schema 不再注入, 重新启用后恢复', () => {
    const dir = makePluginsDir()
    const settingsPath = join(dir, 'settings.json')
    installPlugin(dir, 'greeter', '示例', GOOD_CODE, false)
    fs.writeFileSync(settingsPath, JSON.stringify({ general: { pluginStates: { greeter: { enabled: false } } } }), 'utf-8')
    expect(getPluginToolSpecs(dir, true, settingsPath)).toHaveLength(0)
    expect(isPluginDisabled(settingsPath, 'greeter')).toBe(true)
    fs.writeFileSync(settingsPath, JSON.stringify({ general: { pluginStates: { greeter: { enabled: true } } } }), 'utf-8')
    expect(getPluginToolSpecs(dir, true, settingsPath).map(s => s.function.name)).toEqual(['plugin_greeter__hello'])
  })

  it('settings schema 校验并写入 manifest', () => {
    const dir = makePluginsDir()
    const settings = [
      { key: 'api_endpoint', label: '接口地址', type: 'string', default: 'https://x' },
      { key: 'mode', label: '模式', type: 'select', options: ['a', 'b'], default: 'a' },
      { key: 'verbose', label: '详细输出', type: 'boolean', default: false },
    ] as import('../shared/settings-types').PluginSettingDef[]
    const r = installPlugin(dir, 'cfg', '示例', GOOD_CODE, false, settings)
    expect(r.ok).toBe(true)
    const m = JSON.parse(fs.readFileSync(join(dir, 'cfg', 'manifest.json'), 'utf-8'))
    expect(m.settings).toEqual(settings)
    expect(validatePluginSettings([{ key: 'bad key!', label: 'x' }]).ok).toBe(false)
    expect(validatePluginSettings([{ key: 'sel', label: 'x', type: 'select' }]).ok).toBe(false)
    expect(validatePluginSettings([{ key: 'n', label: 'x', type: 'number', default: '1' }]).ok).toBe(false)
  })
})
