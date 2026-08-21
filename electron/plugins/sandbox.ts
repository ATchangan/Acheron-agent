// electron/plugins/sandbox.ts — 插件沙箱基元(无 electron 依赖, 可单测)
// createHardenedContext: 禁 eval/Function/WebAssembly 字符串代码生成 —— 封堵 vm 经典逃逸
// loadPluginToolsStatic: 静态读取 module.exports.tools 元数据(顶层仅 path, 不执行 run, 10s 超时)
import * as vm from 'vm'

export function createHardenedContext(sandbox: Record<string, unknown>): vm.Context {
  return vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } })
}

export function loadPluginToolsStatic(code: string, timeoutMs = 10000): unknown[] {
  const sandbox: Record<string, unknown> = {
    module: { exports: {} },
    exports: {},
    require: (modName: unknown): unknown => {
      const m = String(modName || '')
      if (m === 'path' || m === 'node:path') return require('path')
      throw new Error('E:PLUGIN_FORBIDDEN: 顶层仅允许 require("path"), 文件与网络操作请放在 run() 内: ' + m)
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
  }
  const ctx = createHardenedContext(sandbox)
  vm.runInContext(code, ctx, { timeout: timeoutMs })
  const exported = vm.runInContext('module.exports', ctx, { timeout: 1000 })
  return Array.isArray(exported?.tools) ? exported.tools : []
}
