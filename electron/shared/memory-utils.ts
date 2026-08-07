// electron/shared/memory-utils.ts —— renderer/main 共享记忆纯函数（scoreOverlap dedup）
// 约束：禁止 import electron API / zustand / fs

export function scoreOverlap(content: string, userMsg: string): number {
  const tokens = (s: string): string[] => {
    const en = (s.match(/[a-z0-9]+/gi) || []).map(x => x.toLowerCase())
    const zh = (s.match(/[\u4e00-\u9fff]/g) || [])
    const bigrams: string[] = []
    for (let i = 0; i + 1 < zh.length; i++) bigrams.push(zh[i] + zh[i + 1])
    return [...en, ...bigrams]
  }
  const a = new Set(tokens(userMsg))
  if (!a.size) return 0
  return tokens(content).filter(t => a.has(t)).length
}

// ── 记忆安全扫描（B6-2：renderer/main 共用同一份，写入前拒绝敏感/注入内容） ──
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._-]{20,}\b/i,
  /\bapi[_-]?key\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\bauthorization\s*[:=]\s*["']?[A-Za-z0-9._-]{12,}/i,
  /\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{20,}\b/,
]
const INJECT_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions|prompts)/i,
  /disregard\s+(all\s+)?(prior|previous)\s+(instructions|rules)/i,
  /you\s+are\s+now\s+an?\s+unrestricted/i,
  /忽略(之前|以上|所有)?的?(指令|提示|规则)/,
  /(你现在|你是).{0,10}(不受限制|自由)的?(AI|助手)/,
]

export function scanMemoryText(text: string): { ok: boolean; reason?: string } {
  const t = String(text || '')
  if (!t) return { ok: true }
  for (const re of SECRET_PATTERNS) {
    const m = t.match(re)
    if (m) return { ok: false, reason: '疑似包含密钥/凭证(' + m[0].slice(0, 12) + '…)，已拒绝写入记忆' }
  }
  for (const re of INJECT_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: '疑似提示注入内容，已拒绝写入记忆' }
  }
  return { ok: true }
}
