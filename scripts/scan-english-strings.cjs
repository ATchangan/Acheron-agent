// 扫描源码字符串字面量中的英文短语（用于人工甄别用户可见英文残留）
const fs = require('node:fs')
const path = require('node:path')
const base = path.join(__dirname, '..')
const roots = [path.join(base, 'src'), path.join(base, 'electron')]
const files = []
for (const root of roots) {
  ;(function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.(tsx|ts)$/.test(f)) files.push(p)
    }
  })(root)
}

const words = /(New Chat|Open Chat|Chat List|Loading|Error|Failed|Success|Cancel|Confirm|Delete|Close|Save|Settings|Tools|Model|Memory|Skills|Plugins|Provider|Import|Export|Refresh|Retry|Install|Update|Download|Upload|Connect|Disable|Enable|Start|Stop|Ready|Unknown|Pending|Waiting|Processing|Done|Copy|Paste|Search|Browse|Browser|Workspace|Session|Conversation|Message|Role|Agent|System|User|Assistant|Tool|Cron|Schedule|Knowledge|Strategy|Persona|Stats|Log|Terminal|Empty|None|Yes|No|OK|Next|Back)/i

for (const p of files) {
  const c = fs.readFileSync(p, 'utf8')
  const lines = c.split(/\r?\n/)
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t || t.startsWith('//') || t.startsWith('*')) return
    const hits = []
    for (const m of t.matchAll(/(['"`])([A-Za-z][A-Za-z0-9 ._\/\-()%:]*[A-Za-z0-9])\1/g)) {
      const s = m[2]
      if ((/[A-Za-z]{3,}\s+[A-Za-z]{2,}/.test(s) || words.test(s)) && !/^(https?|sk-|key=|value=)/i.test(s)) hits.push(s)
    }
    if (hits.length) console.log(path.relative(base, p) + ' ' + (i + 1) + '| ' + hits.join(' ; ') + ' || ' + t.slice(0, 140))
  })
}

// 精确短语扫描（独立字面量，排除代码标识）
const phrases = ["'New Chat'", '"New Chat"', "'Hello World'", '"Hello World"', "'Loading'", '"Loading"', "'Error'", '"Error"', "'Failed'", '"Failed"', "'Success'", '"Success"', "'Cancel'", '"Cancel"', "'Close'", '"Close"', "'Save'", '"Save"', "'Delete'", '"Delete"', "'OK'", '"OK"', "'Done'", '"Done"', "'Ready'", '"Ready"', "'None'", '"None"', "'All'", '"All"', "'Empty'", '"Empty"', "'Chat'", '"Chat"', "'Settings'", '"Settings"', "'Tools'", '"Tools"', "'Memory'", '"Memory"', "'Skills'", '"Skills"', "'Plugins'", '"Plugins"', "'Browser'", '"Browser"', "'Search'", '"Search"', "'Agent 编队'", '"Agent 编队"']
for (const p of files) {
  const c = fs.readFileSync(p, 'utf8')
  const lines = c.split(/\r?\n/)
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t || t.startsWith('//') || t.startsWith('*')) return
    for (const ph of phrases) {
      if (t.includes(ph)) {
        console.log('[PHRASE] ' + path.relative(base, p) + ' ' + (i + 1) + '| ' + ph + ' || ' + t.slice(0, 160))
        break
      }
    }
  })
}
