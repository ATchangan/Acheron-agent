// 设置字段一致性检查: UI 保存字段 vs GeneralSettings 类型 vs 使用处
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8')

// 1. GeneralSettings interface 字段
const types = read('src/types.ts')
const gsMatch = types.match(/export interface GeneralSettings \{([\s\S]*?)\n\}/)
const typeFields = new Set()
if (gsMatch) {
  for (const line of gsMatch[1].split('\n')) {
    const m = line.match(/^\s{2}([a-zA-Z][a-zA-Z0-9_]*)\??:/)
    if (m) typeFields.add(m[1])
  }
}

// 2. UI 保存字段
const uiSave = new Set()
const settingsDir = path.join(root, 'src/components/settings')
for (const f of fs.readdirSync(settingsDir).filter(x => x.endsWith('.tsx'))) {
  const c = fs.readFileSync(path.join(settingsDir, f), 'utf-8')
  for (const m of c.matchAll(/save\(\{\s*([a-zA-Z0-9_]+)\s*[:=]/g)) uiSave.add(m[1])
  for (const m of c.matchAll(/setState\([^)]*\{\s*general:\s*\{\s*([a-zA-Z0-9_]+)\s*:/g)) uiSave.add(m[1])
  for (const m of c.matchAll(/updateGeneral\(\{\s*([a-zA-Z0-9_]+)\s*:/g)) uiSave.add(m[1])
}

// 3. 使用处(runtime/context/chat/memory/settings 等读取字段)
const used = new Set()
for (const f of ['src/store/runtime.ts', 'src/store/context.ts', 'src/store/chat-send.ts', 'src/store/chat-llm.ts', 'src/store/settings.ts', 'src/store/memory.ts', 'src/store/model-pick.ts', 'src/store/subtask.ts', 'src/store/chat-round.ts']) {
  const c = read(f)
  for (const m of c.matchAll(/\.([a-zA-Z][a-zA-Z0-9_]*)\b/g)) used.add(m[1])
}

// 输出: UI 有但类型无
console.log('=== UI 保存但 GeneralSettings 类型缺失(可能无效字段) ===')
const uiNoType = [...uiSave].filter(x => !typeFields.has(x)).sort()
console.log(uiNoType.join(', ') || '(无)')

// 输出: 类型有但 UI 无配置入口
console.log('=== GeneralSettings 有但设置页无保存入口 ===')
const typeNoUi = [...typeFields].filter(x => !uiSave.has(x) && !['stat_sessions', 'stat_memory', 'stat_plugins', 'stat_cache', 'stat_workspace', 'stat_settings', 'stat_cacheHits', 'stat_cacheMisses', 'stat_cacheRate', 'uiFontSize', 'messageSpacing', 'showTimestamps'].includes(x)).sort()
console.log(typeNoUi.join(', ') || '(无)')

// 输出: 类型有但从未被代码读取(疑似死字段)
console.log('=== 类型有但代码从未读取(疑似死字段) ===')
const typeNoUse = [...typeFields].filter(x => !used.has(x)).sort()
console.log(typeNoUse.join(', ') || '(无)')
