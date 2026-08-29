// src/test-setup.ts — node 环境渲染测试的全局垫片(在任何 import 之前加载)
const g = globalThis as unknown as Record<string, unknown>
if (!g.localStorage) {
  g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
}
if (!g.window) {
  const win: Record<string, unknown> = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    setTimeout,
    clearTimeout,
  }
  win.localStorage = g.localStorage
  win.window = win
  g.window = win
}
if (!g.document) {
  g.document = { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] }
}
if (!g.requestAnimationFrame) {
  g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number
  g.cancelAnimationFrame = (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
}
export {}
