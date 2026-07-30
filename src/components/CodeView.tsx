import React, { useState, useEffect, useCallback, useRef } from 'react'

/* ─── 黄泉符文工坊 · 类型 & 常量 ──────────────────────────── */

type Lang = 'python' | 'javascript' | 'typescript' | 'powershell' | 'bash'

interface HistoryEntry {
  lang: Lang
  code: string
  output: string
  duration: number
  timestamp: number
}

interface Template {
  label: string
  lang: Lang
  code: string
}

const LANGS: { id: Lang; label: string; ext: string; icon: string }[] = [
  { id: 'python',     label: 'Python',     ext: '.py',  icon: '🐍' },
  { id: 'javascript', label: 'JavaScript', ext: '.js',  icon: '🟨' },
  { id: 'typescript', label: 'TypeScript', ext: '.ts',  icon: '🔷' },
  { id: 'powershell', label: 'PowerShell', ext: '.ps1', icon: '💙' },
  { id: 'bash',       label: 'Bash',       ext: '.sh',  icon: '🐚' },
]

/* ─── 模板 ─────────────────────────────────────────────── */

const PY_TEMPLATES: Template[] = [
  {
    label: 'Hello World',
    lang: 'python',
    code: `# 🐍 Python Hello World
print("Hello, 黄泉世界! 🌊")
print(f"3 + 4 = {3 + 4}")

# 列表推导式
squares = [x**2 for x in range(10)]
print(f"平方数: {squares}")`,
  },
  {
    label: '文件读取',
    lang: 'python',
    code: `# 📄 读取文件内容
import os

# 获取当前工作目录
cwd = os.getcwd()
print(f"当前目录: {cwd}")

# 列出当前目录文件
files = os.listdir('.')
print(f"\\n目录内容 ({len(files)} 项):")
for f in files[:20]:
    print(f"  {'📁' if os.path.isdir(f) else '📄'} {f}")

# 读取指定文件 (请修改路径)
# with open('example.txt', 'r', encoding='utf-8') as f:
#     content = f.read()
#     print(f"\\n文件内容: {content[:500]}")`,
  },
  {
    label: 'HTTP请求',
    lang: 'python',
    code: `# 🌐 HTTP 请求示例
import urllib.request
import json

try:
    # 发送 GET 请求
    url = "https://api.github.com/repos/python/cpython"
    req = urllib.request.Request(url, headers={"User-Agent": "HuangQuan/1.0"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        print(f"仓库: {data.get('full_name')}")
        print(f"⭐ Stars: {data.get('stargazers_count')}")
        print(f"🍴 Forks: {data.get('forks_count')}")
        print(f"📝 描述: {data.get('description', 'N/A')[:100]}")
        print(f"🔤 语言: {data.get('language')}")
except Exception as e:
    print(f"❌ 请求失败: {e}")`,
  },
  {
    label: '数据分析',
    lang: 'python',
    code: `# 📊 数据分析示例
import json
import math
from collections import Counter

# 模拟数据
data = {
    "items": [
        {"name": "苹果", "price": 5.5, "category": "水果", "sales": 120},
        {"name": "香蕉", "price": 3.0, "category": "水果", "sales": 200},
        {"name": "牛奶", "price": 8.0, "category": "饮品", "sales": 85},
        {"name": "面包", "price": 6.5, "category": "烘焙", "sales": 150},
        {"name": "咖啡", "price": 15.0, "category": "饮品", "sales": 60},
        {"name": "蛋糕", "price": 25.0, "category": "烘焙", "sales": 40},
    ]
}

items = data["items"]

# 总销售额
total_revenue = sum(it["price"] * it["sales"] for it in items)
print(f"💰 总销售额: ¥{total_revenue:,.2f}")

# 按类别统计
cat_revenue = {}
for it in items:
    cat = it["category"]
    cat_revenue[cat] = cat_revenue.get(cat, 0) + it["price"] * it["sales"]

print("\\n📂 各类别销售额:")
for cat, rev in sorted(cat_revenue.items(), key=lambda x: -x[1]):
    print(f"  {cat}: ¥{rev:,.2f}")

# 均价
avg_price = sum(it["price"] for it in items) / len(items)
print(f"\\n📊 均价: ¥{avg_price:.2f}")
print(f"📈 商品数量: {len(items)}")
print(f"🔥 最高销量: {max(items, key=lambda x: x['sales'])['name']}")
print(f"💎 最贵商品: {max(items, key=lambda x: x['price'])['name']}")`,
  },
]

const NODE_TEMPLATES: Template[] = [
  {
    label: 'Hello World',
    lang: 'javascript',
    code: `// 🟨 Node.js Hello World
console.log("Hello, 黄泉世界! 🌊");
console.log(\`Node version: \${process.version}\`);
console.log(\`Platform: \${process.platform}\`);

// 数组操作
const nums = [1, 2, 3, 4, 5];
const doubled = nums.map(n => n * 2);
console.log(\`Doubled: [\${doubled.join(', ')}]\`);

// 异步示例
Promise.resolve(42).then(val => {
  console.log(\`Promise resolved: \${val}\`);
});`,
  },
  {
    label: '文件操作',
    lang: 'javascript',
    code: `// 📄 Node.js 文件操作
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
console.log(\`当前目录: \${cwd}\`);

// 列出目录
try {
  const files = fs.readdirSync(cwd);
  console.log(\`\\n目录内容 (\${files.length} 项):\`);
  files.slice(0, 20).forEach(f => {
    const stat = fs.statSync(path.join(cwd, f));
    const icon = stat.isDirectory() ? '📁' : '📄';
    console.log(\`  \${icon} \${f} (\${stat.size} bytes)\`);
  });
} catch (e) {
  console.error(\`❌ 错误: \${e.message}\`);
}`,
  },
  {
    label: 'HTTP服务器',
    lang: 'javascript',
    code: `// 🌐 简单 HTTP 服务器
const http = require('http');

const PORT = 3000;
const server = http.createServer((req, res) => {
  console.log(\`\${req.method} \${req.url}\`);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    message: '黄泉符文工坊',
    time: new Date().toISOString(),
    url: req.url,
    method: req.method,
  }, null, 2));
});

server.listen(PORT, () => {
  console.log(\`🚀 服务器已启动: http://localhost:\${PORT}\`);
  console.log('按 Ctrl+C 停止服务器');
  // 注意: 在沙箱环境中服务器可能无法正常运行
  // 这只是一个模板示例
});`,
  },
]

const PS_TEMPLATES: Template[] = [
  {
    label: '系统信息',
    lang: 'powershell',
    code: `# 💙 系统信息
Write-Host "=== 黄泉系统信息 ===" -ForegroundColor Cyan
Write-Host ""

# 操作系统
$os = Get-CimInstance Win32_OperatingSystem
Write-Host "操作系统: $($os.Caption)"
Write-Host "版本: $($os.Version)"
Write-Host "架构: $($os.OSArchitecture)"
Write-Host ""

# 内存
$totalMem = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeMem = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Write-Host "总内存: $totalMem GB"
Write-Host "可用内存: $freeMem GB"
Write-Host ""

# 运行时间
$uptime = (Get-Date) - $os.LastBootUpTime
Write-Host "系统运行时间: $($uptime.Days) 天 $($uptime.Hours) 小时"

Get-Date | ForEach-Object { Write-Host "\`n当前时间: $_" }`,
  },
  {
    label: '进程列表',
    lang: 'powershell',
    code: `# 📋 进程列表 (Top 15)
Write-Host "=== Top 15 进程 (按内存) ===" -ForegroundColor Cyan
Write-Host ""

$processes = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 15

Write-Host ("{0,-8} {1,-35} {2,15} {3,10}" -f "PID", "Name", "Memory(MB)", "Threads")
Write-Host ("-" * 72)

foreach ($p in $processes) {
    $memMB = if ($p.WorkingSet64) { [math]::Round($p.WorkingSet64 / 1MB, 1) } else { 0 }
    Write-Host ("{0,-8} {1,-35} {2,15:N1} {3,10}" -f $p.Id, $p.ProcessName, $memMB, $p.Threads.Count)
}

Write-Host ""
Write-Host "总进程数: $((Get-Process).Count)"`,
  },
]

const TEMPLATES: Template[] = [
  ...PY_TEMPLATES.map(t => ({ ...t, label: `🐍 ${t.label}` })),
  ...NODE_TEMPLATES.map(t => ({ ...t, label: `🟨 ${t.label}` })),
  ...PS_TEMPLATES.map(t => ({ ...t, label: `💙 ${t.label}` })),
]

/* ─── 辅助函数 ────────────────────────────────────────── */

function detectLang(filename: string): Lang | null {
  const ext = filename.toLowerCase().split('.').pop() || ''
  const map: Record<string, Lang> = {
    py: 'python', pyw: 'python',
    js: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', mts: 'typescript',
    ps1: 'powershell', psd1: 'powershell', psm1: 'powershell',
    sh: 'bash', bash: 'bash', zsh: 'bash',
  }
  return map[ext] || null
}

function extForLang(lang: Lang): string {
  const found = LANGS.find(l => l.id === lang)
  return found ? found.ext : '.txt'
}

/* ─── 样式 ────────────────────────────────────────────── */

const S = {
  root: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    backgroundColor: '#0D0D1A',
    color: '#E8E8F0',
    overflow: 'hidden',
  } as React.CSSProperties,

  header: {
    padding: '16px 20px 0',
    flexShrink: 0,
  } as React.CSSProperties,

  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as React.CSSProperties,

  icon: { fontSize: '26px' } as React.CSSProperties,

  title: {
    fontSize: '18px',
    fontWeight: 600 as const,
    color: '#E8E8F0',
    margin: 0,
  } as React.CSSProperties,

  subtitle: {
    fontSize: '11px',
    color: '#9999AA',
    marginTop: '2px',
  } as React.CSSProperties,

  /* ── 工具栏 ── */
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '12px',
    flexWrap: 'wrap' as const,
    paddingBottom: '10px',
    borderBottom: '1px solid #2A2A4A',
  } as React.CSSProperties,

  langTab: (active: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    borderRadius: '5px',
    border: 'none',
    background: active ? 'rgba(107,76,154,.20)' : 'transparent',
    color: active ? '#6B4C9A' : '#7777AA',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: active ? (600 as const) : (400 as const),
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  }),

  toolbarSep: {
    width: '1px',
    height: '20px',
    background: '#2A2A4A',
  } as React.CSSProperties,

  actionBtn: (color?: string): React.CSSProperties => ({
    padding: '4px 10px',
    borderRadius: '5px',
    border: 'none',
    background: 'rgba(107,76,154,.12)',
    color: color || '#B8B8D0',
    cursor: 'pointer',
    fontSize: '11px',
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  }),

  runBtn: {
    padding: '4px 16px',
    borderRadius: '5px',
    border: 'none',
    background: '#6B4C9A',
    color: '#FFFFFF',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600 as const,
    transition: 'all .12s',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  /* ── 主体: 上60%编辑器 / 下40%输出 ── */
  body: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    padding: '12px 20px',
  } as React.CSSProperties,

  editorPane: {
    flex: '6',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    marginBottom: '8px',
  } as React.CSSProperties,

  editorHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    marginBottom: '6px',
  } as React.CSSProperties,

  editorLabel: {
    fontSize: '11px',
    color: '#9999AA',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  editorWrap: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
    background: '#1A1A2E',
    border: '1px solid #2A2A4A',
    borderRadius: '8px',
    overflow: 'hidden',
  } as React.CSSProperties,

  lineNumbers: {
    width: '44px',
    minWidth: '44px',
    background: '#12122A',
    borderRight: '1px solid #2A2A4A',
    padding: '10px 4px 10px 0',
    overflow: 'hidden',
    textAlign: 'right' as const,
    fontSize: '12px',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    color: '#4A4A6A',
    lineHeight: '1.6',
    userSelect: 'none' as const,
    whiteSpace: 'pre' as const,
  } as React.CSSProperties,

  textarea: {
    flex: 1,
    background: '#1A1A2E',
    border: 'none',
    color: '#E8E8F0',
    padding: '10px 14px',
    fontSize: '13px',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    lineHeight: '1.6',
    resize: 'none' as const,
    outline: 'none',
    minHeight: 0,
    tabSize: 2,
  } as React.CSSProperties,

  /* ── 输出面板 ── */
  outputPane: {
    flex: '4',
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
  } as React.CSSProperties,

  outputHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    marginBottom: '6px',
  } as React.CSSProperties,

  outputLabel: {
    fontSize: '11px',
    color: '#9999AA',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  outputDuration: {
    fontSize: '10px',
    color: '#6B4C9A',
    marginLeft: '8px',
  } as React.CSSProperties,

  console: {
    flex: 1,
    background: '#0A0A16',
    border: '1px solid #2A2A4A',
    borderRadius: '8px',
    padding: '10px 14px',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
    fontSize: '12px',
    color: '#48c98a',
    lineHeight: '1.5',
    overflow: 'auto',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    minHeight: 0,
    margin: 0,
  } as React.CSSProperties,

  consolePlaceholder: {
    color: '#3A3A5A',
    fontStyle: 'italic' as const,
  } as React.CSSProperties,

  /* ── 历史面板 ── */
  historyPanel: {
    background: '#1A1A2E',
    border: '1px solid #2A2A4A',
    borderRadius: '8px',
    marginTop: '8px',
    maxHeight: '160px',
    overflowY: 'auto' as const,
    flexShrink: 0,
  } as React.CSSProperties,

  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between' as const,
    alignItems: 'center',
    padding: '6px 12px',
    borderBottom: '1px solid #2A2A4A',
    position: 'sticky' as const,
    top: 0,
    background: '#1A1A2E',
    zIndex: 1,
  } as React.CSSProperties,

  historyTitle: {
    fontSize: '10px',
    color: '#9999AA',
    fontWeight: 600 as const,
  } as React.CSSProperties,

  historyClear: {
    fontSize: '10px',
    color: '#666688',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  } as React.CSSProperties,

  historyItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 12px',
    borderBottom: '1px solid #1E1E38',
    cursor: 'pointer',
    transition: 'all .1s',
    fontSize: '11px',
  } as React.CSSProperties,

  historyLang: (lang: Lang): React.CSSProperties => {
    const colors: Record<Lang, string> = {
      python: '#4B8BBE',
      javascript: '#F0DB4F',
      typescript: '#3178C6',
      powershell: '#5391FE',
      bash: '#89E051',
    }
    return {
      fontSize: '10px',
      padding: '1px 6px',
      borderRadius: '3px',
      background: 'rgba(0,0,0,.25)',
      color: colors[lang] || '#9999AA',
      fontWeight: 600 as const,
      whiteSpace: 'nowrap' as const,
      minWidth: '60px',
      textAlign: 'center' as const,
    }
  },

  historyCode: {
    color: '#B8B8D0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    fontSize: '11px',
    fontFamily: "'Fira Code', 'Cascadia Code', 'JetBrains Mono', 'Consolas', monospace",
  } as React.CSSProperties,

  historyTime: {
    fontSize: '10px',
    color: '#5A5A78',
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,

  /* ── 模板下拉 ── */
  templateOverlay: {
    position: 'absolute' as const,
    top: '100%',
    left: 0,
    zIndex: 10,
    background: '#1E1E38',
    border: '1px solid #2A2A4A',
    borderRadius: '8px',
    padding: '6px 0',
    minWidth: '200px',
    boxShadow: '0 8px 24px rgba(0,0,0,.5)',
    marginTop: '4px',
  } as React.CSSProperties,

  templateItem: {
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#E8E8F0',
    border: 'none',
    background: 'none',
    width: '100%',
    textAlign: 'left' as const,
    display: 'block',
    transition: 'all .08s',
  } as React.CSSProperties,

  /* ── Toast ── */
  toast: {
    position: 'fixed' as const,
    bottom: '20px',
    right: '20px',
    background: '#1E1E38',
    border: '1px solid #6B4C9A',
    color: '#E8E8F0',
    padding: '8px 16px',
    borderRadius: '8px',
    fontSize: '12px',
    zIndex: 100,
    boxShadow: '0 4px 16px rgba(0,0,0,.5)',
    transition: 'opacity .2s',
  } as React.CSSProperties,
}

/* ─── 黄泉符文工坊 组件 ──────────────────────────────────── */

export default function CodeView() {
  /* ── state ── */
  const [lang, setLang] = useState<Lang>('python')
  const [code, setCode] = useState('')
  const [output, setOutput] = useState('')
  const [running, setRunning] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const [toast, setToast] = useState('')
  const [showHistory, setShowHistory] = useState(true)
  const [memLoaded, setMemLoaded] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const templateBtnRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>()

  const lineCount = Math.max(code.split('\n').length, 1)

  /* ── toast helper ── */
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }, [])

  /* ── 加载历史 ── */
  const loadHistory = useCallback(async () => {
    try {
      const data = await window.huangquan.memory.load()
      const facts: string[] = data.facts || []
      const histEntries: HistoryEntry[] = []
      for (const fact of facts) {
        if (fact.startsWith('[codehist]')) {
          try {
            const json = fact.slice('[codehist]'.length).trim()
            histEntries.push(JSON.parse(json))
          } catch { /* skip malformed */ }
        }
      }
      histEntries.sort((a, b) => b.timestamp - a.timestamp)
      setHistory(histEntries.slice(0, 20))
    } catch {
      // memory not available
    } finally {
      setMemLoaded(true)
    }
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  /* ── 持久化一条历史 ── */
  const persistHistory = useCallback(async (entry: HistoryEntry) => {
    try {
      const data = await window.huangquan.memory.load()
      const facts: string[] = data.facts || []
      // 移除旧的 [codehist] 条目
      const other = facts.filter(f => !f.startsWith('[codehist]'))
      const histRaws = facts
        .filter(f => f.startsWith('[codehist]'))
        .map(f => {
          try {
            const raw = f.slice('[codehist]'.length).trim()
            return JSON.parse(raw) as HistoryEntry
          } catch { return null }
        })
        .filter(Boolean) as HistoryEntry[]

      // 添加新条目，保留最近 20 条
      histRaws.push(entry)
      histRaws.sort((a, b) => b.timestamp - a.timestamp)
      const kept = histRaws.slice(0, 20)
      const newFacts = [...other, ...kept.map(e => `[codehist] ${JSON.stringify(e)}`)]
      await window.huangquan.memory.save({ facts: newFacts, summaries: data.summaries || [] })
      setHistory(kept)
    } catch {
      // silently fail persistence
    }
  }, [])

  /* ── 清除历史 ── */
  const clearHistory = useCallback(async () => {
    try {
      const data = await window.huangquan.memory.load()
      const facts = (data.facts || []).filter(f => !f.startsWith('[codehist]'))
      await window.huangquan.memory.save({ facts, summaries: data.summaries || [] })
      setHistory([])
      showToast('🗑️ 执行历史已清除')
    } catch {
      showToast('⚠️ 清除失败')
    }
  }, [showToast])

  /* ── 执行代码 ── */
  const handleRun = useCallback(async () => {
    if (!code.trim()) return
    setRunning(true)
    setDuration(null)
    setOutput('')
    const startTime = performance.now()

    try {
      let result = ''
      // 尝试 codebox sandbox，回退到 exec
      const codebox = (window.huangquan.computer as any).codebox as
        ((l: string, c: string) => Promise<string>) | undefined

      if (lang === 'powershell') {
        // PowerShell: 写入临时文件然后执行
        const psPath = `__huangquan_temp.ps1`
        await window.huangquan.computer.writeFile(psPath, code)
        result = await window.huangquan.computer.exec(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psPath}"`)
        await window.huangquan.computer.exec(`del "${psPath}" 2>nul || rm "${psPath}" 2>/dev/null || true`)
      } else if (lang === 'bash') {
        // Bash: 写入临时文件然后执行
        const shPath = `__huangquan_temp.sh`
        await window.huangquan.computer.writeFile(shPath, code)
        result = await window.huangquan.computer.exec(`bash "${shPath}"`)
        await window.huangquan.computer.exec(`rm -f "${shPath}"`)
      } else if (codebox) {
        // 使用 codebox sandbox
        const langMap: Record<string, string> = {
          python: 'python',
          javascript: 'javascript',
          typescript: 'typescript',
        }
        result = await codebox(langMap[lang] || lang, code)
      } else {
        // fallback: 写入文件后执行
        const ext = extForLang(lang)
        const tmpPath = `__huangquan_temp${ext}`
        await window.huangquan.computer.writeFile(tmpPath, code)

        const cmdMap: Record<string, string> = {
          python: `python "${tmpPath}"`,
          javascript: `node "${tmpPath}"`,
          typescript: `npx tsx "${tmpPath}"`,
        }
        const cmd = cmdMap[lang]
        if (cmd) {
          result = await window.huangquan.computer.exec(cmd)
        } else {
          result = await window.huangquan.computer.exec(`cat "${tmpPath}"`)
        }
        // 清理
        await window.huangquan.computer.exec(`rm -f "${tmpPath}"`)
      }

      const elapsed = Math.round((performance.now() - startTime))
      setDuration(elapsed)
      setOutput(result || '(无输出)')

      // 保存到历史
      const entry: HistoryEntry = {
        lang,
        code,
        output: result || '(无输出)',
        duration: elapsed,
        timestamp: Date.now(),
      }
      await persistHistory(entry)
    } catch (e: any) {
      const elapsed = Math.round((performance.now() - startTime))
      setDuration(elapsed)
      setOutput(`❌ 执行错误:\n${e?.message || e?.toString?.() || '未知错误'}`)

      const entry: HistoryEntry = {
        lang,
        code,
        output: `❌ ${e?.message || '未知错误'}`,
        duration: elapsed,
        timestamp: Date.now(),
      }
      await persistHistory(entry)
    } finally {
      setRunning(false)
    }
  }, [code, lang, persistHistory])

  /* ── 模板 ── */
  const applyTemplate = useCallback((tpl: Template) => {
    setLang(tpl.lang)
    setCode(tpl.code)
    setOutput('')
    setDuration(null)
    setShowTemplates(false)
    showToast(`📋 已加载模板: ${tpl.label}`)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [showToast])

  /* ── 文件操作 ── */
  const handleOpenFile = useCallback(async () => {
    try {
      const path = await window.huangquan.computer.selectFile()
      if (!path) return
      const content = await window.huangquan.computer.readFile(path)
      const detected = detectLang(path)
      if (detected) setLang(detected)
      setCode(content)
      setOutput('')
      setDuration(null)
      showToast(`📂 已打开: ${path.split(/[/\\]/).pop()}`)
    } catch (e: any) {
      showToast(`⚠️ 打开失败: ${e?.message || '未知错误'}`)
    }
  }, [showToast])

  const handleSaveFile = useCallback(async () => {
    try {
      const ext = extForLang(lang)
      const filename = prompt('保存为文件名:', `huangquan_script${ext}`)
      if (!filename) return
      await window.huangquan.computer.writeFile(filename, code)
      showToast(`💾 已保存: ${filename}`)
    } catch (e: any) {
      showToast(`⚠️ 保存失败: ${e?.message || '未知错误'}`)
    }
  }, [code, lang, showToast])

  /* ── 清空编辑器 ── */
  const handleClear = useCallback(() => {
    setCode('')
    setOutput('')
    setDuration(null)
    showToast('🧹 编辑器已清空')
    textareaRef.current?.focus()
  }, [showToast])

  /* ── 从历史加载 ── */
  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setLang(entry.lang)
    setCode(entry.code)
    setOutput(entry.output)
    setDuration(entry.duration)
    showToast('📜 已加载历史记录')
  }, [showToast])

  /* ── 关闭模板下拉 (点击外部) ── */
  useEffect(() => {
    if (!showTemplates) return
    const handler = (e: MouseEvent) => {
      if (templateBtnRef.current && !templateBtnRef.current.contains(e.target as Node)) {
        setShowTemplates(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showTemplates])

  /* ── 键盘快捷键 ── */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter 执行
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleRun()
    }
    // Tab 缩进
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      if (!ta) return
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const before = code.slice(0, start)
      const after = code.slice(end)
      const newCode = before + '  ' + after
      setCode(newCode)
      // 恢复光标位置
      requestAnimationFrame(() => {
        ta.focus()
        ta.selectionStart = ta.selectionEnd = start + 2
      })
    }
  }, [code, handleRun])

  /* ── 行号生成 ── */
  const lineNumbers = Array.from({ length: Math.max(lineCount, 1) }, (_, i) =>
    String(i + 1).padStart(3, ' ')
  ).join('\n')

  /* ── 同步滚动 ── */
  const handleEditorScroll = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const lineNumDiv = ta.parentElement?.querySelector('[data-line-nums]') as HTMLElement | null
    if (lineNumDiv) {
      lineNumDiv.scrollTop = ta.scrollTop
    }
  }, [])

  /* ── render ── */
  return (
    <div style={S.root}>
      {/* ═══ Header ═══ */}
      <div style={S.header}>
        <div style={S.titleRow}>
          <span style={S.icon}>⚒️</span>
          <div>
            <h1 style={S.title}>⌘ 代码沙箱</h1>
            <p style={S.subtitle}>代码沙箱 · 即刻运行 · {history.length} 条历史</p>
          </div>
        </div>

        {/* ── 工具栏 ── */}
        <div style={S.toolbar}>
          {LANGS.map(l => (
            <button
              key={l.id}
              style={S.langTab(lang === l.id)}
              onClick={() => setLang(l.id)}
              title={l.label}
            >
              {l.icon} {l.label}
            </button>
          ))}

          <div style={S.toolbarSep} />

          {/* 模板按钮 */}
          <div style={{ position: 'relative' as const }} ref={templateBtnRef}>
            <button
              style={S.actionBtn('#4dc9f6')}
              onClick={() => setShowTemplates(v => !v)}
            >
              📋 模板
            </button>
            {showTemplates && (
              <div style={S.templateOverlay}>
                {TEMPLATES.map((tpl, i) => (
                  <button
                    key={i}
                    style={S.templateItem}
                    onClick={() => applyTemplate(tpl)}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(107,76,154,.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >
                    {tpl.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button style={S.actionBtn()} onClick={handleOpenFile}>
            📂 打开文件
          </button>
          <button style={S.actionBtn()} onClick={handleSaveFile}>
            💾 保存
          </button>
          <button style={S.actionBtn()} onClick={handleClear}>
            🧹 清空
          </button>

          <div style={{ flex: 1 }} />

          <button
            style={{
              ...S.runBtn,
              opacity: running ? 0.6 : 1,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
            onClick={handleRun}
            disabled={running}
          >
            {running ? '⏳ 执行中...' : '▶ 运行'}
          </button>
        </div>
      </div>

      {/* ═══ Body: 编辑器 60% + 输出 40% ═══ */}
      <div style={S.body}>
        {/* ── 编辑器 (上60%) ── */}
        <div style={S.editorPane}>
          <div style={S.editorHeader}>
            <span style={S.editorLabel}>
              📝 {LANGS.find(l => l.id === lang)?.icon} {LANGS.find(l => l.id === lang)?.label} 编辑器
            </span>
            <span style={{ fontSize: '10px', color: '#5A5A78' }}>
              {code.length} 字符 · {lineCount} 行 · Ctrl+Enter 运行
            </span>
          </div>
          <div style={S.editorWrap}>
            <div
              data-line-nums
              style={S.lineNumbers}
              aria-hidden="true"
            >
              {lineNumbers}
            </div>
            <textarea
              ref={textareaRef}
              style={S.textarea}
              value={code}
              onChange={e => setCode(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={handleEditorScroll}
              placeholder={`// 在此输入 ${LANGS.find(l => l.id === lang)?.label} 代码...`}
              spellCheck={false}
              wrap="off"
            />
          </div>
        </div>

        {/* ── 输出面板 (下40%) ── */}
        <div style={S.outputPane}>
          <div style={S.outputHeader}>
            <span style={S.outputLabel}>🖥️ 执行输出</span>
            {duration !== null && (
              <span style={S.outputDuration}>
                ⏱ {duration >= 1000 ? `${(duration / 1000).toFixed(2)}s` : `${duration}ms`}
              </span>
            )}
          </div>
          <pre style={S.console}>
            {output ? (
              output
            ) : (
              <span style={S.consolePlaceholder}>
                {'> 点击「▶ 运行」或按 Ctrl+Enter 执行代码...'}
              </span>
            )}
          </pre>
        </div>

        {/* ── 历史面板 ── */}
        {showHistory && history.length > 0 && (
          <div style={S.historyPanel}>
            <div style={S.historyHeader}>
              <span style={S.historyTitle}>📜 执行历史 ({history.length})</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button style={S.historyClear} onClick={clearHistory}>
                  清除
                </button>
                <button
                  style={S.historyClear}
                  onClick={() => setShowHistory(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            {history.map((entry, i) => (
              <div
                key={`${entry.timestamp}-${i}`}
                style={S.historyItem}
                onClick={() => loadFromHistory(entry)}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(107,76,154,.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={S.historyLang(entry.lang)}>
                  {LANGS.find(l => l.id === entry.lang)?.label || entry.lang}
                </span>
                <span style={S.historyCode}>
                  {entry.code.replace(/\n/g, ' ↵ ').slice(0, 80)}
                  {entry.code.length > 80 ? '…' : ''}
                </span>
                <span style={S.historyTime}>
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        )}

        {!showHistory && history.length > 0 && (
          <div style={{ textAlign: 'center' as const, padding: '4px', flexShrink: 0 }}>
            <button
              style={{ ...S.actionBtn(), fontSize: '10px' }}
              onClick={() => setShowHistory(true)}
            >
              📜 显示历史 ({history.length})
            </button>
          </div>
        )}
      </div>

      {/* ═══ Toast ═══ */}
      {toast && (
        <div style={S.toast}>{toast}</div>
      )}
    </div>
  )
}
