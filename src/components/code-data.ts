// v0.3.1 块 K: 代码工坊 类型/模板/工具(从 CodeView 拆出, 行为零变化)
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { errMsg } from '../utils/safe'

/* ─── 黄泉符文工坊 · 类型 & 常量 ──────────────────────────── */

export type Lang = 'python' | 'javascript' | 'typescript' | 'powershell' | 'bash'

export interface HistoryEntry {
  lang: Lang
  code: string
  output: string
  duration: number
  timestamp: number
}

export interface Template {
  label: string
  lang: Lang
  code: string
}

export const LANGS: { id: Lang; label: string; ext: string; icon: string }[] = [
{ id: 'python',     label: 'Python',     ext: '.py',  icon: 'Py' },
{ id: 'javascript', label: 'JavaScript', ext: '.js',  icon: 'JS' },
{ id: 'typescript', label: 'TypeScript', ext: '.ts',  icon: 'TS' },
{ id: 'powershell', label: 'PowerShell', ext: '.ps1', icon: 'PS' },
{ id: 'bash',       label: 'Bash',       ext: '.sh',  icon: 'sh' },
]

/* ─── 模板 ─────────────────────────────────────────────── */

export const PY_TEMPLATES: Template[] = [
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

export const NODE_TEMPLATES: Template[] = [
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
  console.error(\`❌ 错误: \${errMsg(e)}\`);
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

export const PS_TEMPLATES: Template[] = [
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

export const TEMPLATES: Template[] = [
...PY_TEMPLATES.map(t => ({ ...t, label: `Py · ${t.label}` })),
...NODE_TEMPLATES.map(t => ({ ...t, label: `JS · ${t.label}` })),
...PS_TEMPLATES.map(t => ({ ...t, label: `PS · ${t.label}` })),
]

/* ─── 辅助函数 ────────────────────────────────────────── */

export function detectLang(filename: string): Lang | null {
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

export function extForLang(lang: Lang): string {
  const found = LANGS.find(l => l.id === lang)
  return found ? found.ext : '.txt'
}

/* ─── 黄泉符文工坊 组件 ──────────────────────────────────── */


export const colors: Record<Lang, string> = {
      python: '#4B8BBE',
      javascript: '#F0DB4F',
      typescript: '#3178C6',
      powershell: '#5391FE',
      bash: '#89E051',
    }
