// 扫描用户可见文案：非简体中文（繁体/日文/非技术英文）残留
const fs = require('node:fs')
const path = require('node:path')
const root = path.join(__dirname, '..')

const tradChars = ('這個與會後們說話時樣對應該還點題來裡妳愛電腦機檔設資訊軟體帳權確認刪編輯複製開啟關閉離儲連視瀏覽尋載錯誤範碼網務統庫專發佈檢選輸語圖鈕單欄顯隱監識掛記憶誌計膚淺訂預復進階級簡譯匯幫邊頭頁壓裝驗變態寫讀聽見覺學習問聞門間長東車馬鳥魚龍鳳風雲麼嗎幹乾髒裏並為書畫練習練聲響應號碼幣購買賣輸贏遊遊戲戲劇劇場場地圖書館學習學校老師師傅傅').split('')
const kana = /[\u3040-\u30ff]/

const files = []
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    if (f === 'node_modules' || f === 'dist' || f === 'dist-electron' || f === 'coverage' || f === '.git' || f === 'release' || f === 'docs' || f === '版本发布') continue
    const p = path.join(d, f)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx|ts|js|cjs|mjs|json|html|md)$/.test(f)) files.push(p)
  }
}
walk(root)

let total = 0
for (const f of files) {
  let c
  try { c = fs.readFileSync(f, 'utf8') } catch { continue }
  const lines = c.split(/\r?\n/)
  lines.forEach((l, i) => {
    const t = l.trim()
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#')) return
    const found = []
    for (const ch of tradChars) if (t.includes(ch)) found.push(ch)
    if (kana.test(t)) found.push('日文假名')
    if (found.length) {
      console.log(path.relative(root, f) + ' ' + (i + 1) + ' [' + [...new Set(found)].slice(0, 10).join('') + '] ' + t.slice(0, 140))
      total++
    }
  })
}
console.log('TOTAL:', total)
