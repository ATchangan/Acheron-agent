// src/components/markdown/shiki.ts —— 轻量 shiki 高亮(css-variables 主题 + 增量语言)
// 同步创建 highlighter; 只 boot 常用语言(避免主包体积暴涨), 不认识的 lang 返回 null(降级纯文本)。
import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import langTypeScript from '@shikijs/langs/typescript'
import langJavaScript from '@shikijs/langs/javascript'
import langJson from '@shikijs/langs/json'
import langShellscript from '@shikijs/langs/shellscript'
import langPython from '@shikijs/langs/python'
import langHtml from '@shikijs/langs/html'
import langCss from '@shikijs/langs/css'
import langYaml from '@shikijs/langs/yaml'
import langMarkdown from '@shikijs/langs/markdown'
import langDiff from '@shikijs/langs/diff'
import langBash from '@shikijs/langs/bash'
import langPowershell from '@shikijs/langs/powershell'
import langTsx from '@shikijs/langs/tsx'
import langJsx from '@shikijs/langs/jsx'
import langRust from '@shikijs/langs/rust'
import langGo from '@shikijs/langs/go'
import langJava from '@shikijs/langs/java'
import langCpp from '@shikijs/langs/cpp'
import langSql from '@shikijs/langs/sql'

let highlighter: ReturnType<typeof createHighlighterCoreSync> | null = null

function getHighlighter() {
  if (highlighter) return highlighter
  try {
    highlighter = createHighlighterCoreSync({
      themes: [createCssVariablesTheme({ name: 'css-variables', variablePrefix: '--shiki-', fontStyle: true })],
      langs: [langTypeScript, langJavaScript, langJson, langShellscript, langPython, langHtml, langCss, langYaml, langMarkdown, langDiff, langBash, langPowershell, langTsx, langJsx, langRust, langGo, langJava, langCpp, langSql],
      engine: createJavaScriptRegexEngine(),
    })
  } catch { highlighter = null }
  return highlighter
}

const LS = new Map<string, string>([
  ['ts', 'typescript'], ['typescript', 'typescript'], ['tsx', 'tsx'],
  ['js', 'javascript'], ['javascript', 'javascript'], ['jsx', 'jsx'], ['mjs', 'javascript'], ['mjsx', 'jsx'],
  ['json', 'json'], ['jsonc', 'json'], ['json5', 'json'],
  ['sh', 'shellscript'], ['bash', 'bash'], ['shell', 'shellscript'], ['zsh', 'shellscript'], ['ps1', 'powershell'], ['powershell', 'powershell'],
  ['py', 'python'], ['python', 'python'], ['html', 'html'], ['css', 'css'], ['scss', 'css'], ['less', 'css'],
  ['yaml', 'yaml'], ['yml', 'yaml'], ['md', 'markdown'], ['markdown', 'markdown'],
  ['diff', 'diff'], ['rs', 'rust'], ['rust', 'rust'], ['go', 'go'], ['java', 'java'], ['cpp', 'cpp'], ['c', 'cpp'],
  ['sql', 'sql'], ['kotlin', 'java'], ['kt', 'java'],
])

// 返回高亮 HTML; lang 不支持/未 boot → null(上层降级为 <pre><code>)
export function highlightCode(code: string, lang?: string): string | null {
  if (!lang) return null
  const name = LS.get(lang.toLowerCase()) || lang.toLowerCase()
  const hl = getHighlighter()
  if (!hl) return null
  try {
    return hl.codeToHtml(code, { lang: name, theme: 'css-variables' })
  } catch { return null }
}

export const shiki = { highlight: highlightCode } as const
