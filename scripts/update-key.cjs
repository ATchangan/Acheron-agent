// 把 apikey.txt 中的 key 注入副本 settings.json(验证用, 不打印完整 key)
// 用法: node scripts/update-key.cjs <apikey.txt> <settings.json> [deepseek|glm|qwen]
const fs = require('node:fs')

const keyFile = process.argv[2]
const target = process.argv[3]
const provider = (process.argv[4] || 'deepseek').toLowerCase()
if (!keyFile || !target) { console.log('USAGE: update-key.cjs <keyfile> <settings.json> [deepseek|glm|qwen]'); process.exit(1) }

const text = fs.readFileSync(keyFile, 'utf-8')
const pick = (label, pattern) => {
  const m = text.match(new RegExp(label + '\\s*:\\s*\\r?\\n\\s*(' + pattern + ')', 'i'))
  return m ? m[1].trim() : null
}

const cfg = JSON.parse(fs.readFileSync(target, 'utf-8'))
let p = (cfg.providers || []).find(x => x.baseUrl && String(x.baseUrl).includes('deepseek'))
if (!p) p = (cfg.providers || []).find(x => ['GLM', '通义千问'].includes(x.name))
if (!p) { console.log('NO_DEEPSEEK_PROVIDER'); process.exit(1) }

if (provider === 'glm') {
  const key = pick('GLM api', '[A-Za-z0-9.]+')
  if (!key) { console.log('NO_GLM_KEY'); process.exit(1) }
  Object.assign(p, { name: 'GLM', type: 'OpenAI Compatible', apiKey: key, baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash'], selectedModel: 'glm-4-flash' })
  console.log('KEY_SET: GLM glm-4-flash |', key.slice(0, 8) + '****')
} else if (provider === 'qwen') {
  const key = pick('qwen api', 'sk-[A-Za-z0-9._-]+')
  if (!key) { console.log('NO_QWEN_KEY'); process.exit(1) }
  Object.assign(p, { name: '通义千问', type: 'OpenAI Compatible', apiKey: key, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-flash', 'qwen-turbo'], selectedModel: 'qwen-flash' })
  console.log('KEY_SET: Qwen qwen-flash |', key.slice(0, 8) + '****')
} else {
  const key = pick('deepseek\\s*api', 'sk-[A-Za-z0-9]+')
  if (!key) { console.log('NO_DEEPSEEK_KEY'); process.exit(1) }
  Object.assign(p, { name: 'DeepSeek', type: 'OpenAI Compatible', apiKey: key, baseUrl: 'https://api.deepseek.com', models: ['deepseek-v4-flash'], selectedModel: 'deepseek-v4-flash' })
  console.log('KEY_SET: DeepSeek |', key.slice(0, 8) + '****')
}
fs.writeFileSync(target, JSON.stringify(cfg, null, 2), 'utf-8')
