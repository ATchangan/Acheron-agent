// src/components/markdown/cjk.ts —— 对齐 DSH 的 cjkFriendlyStrong 语法扩展
// 让 `**加粗**` 的星号强调在"前有中文标点、后紧跟中文字符"时也能闭合(CommonMark 默认不闭合)。
// 依赖 micromark 内部 parser 状态, 与 DSH 源码一致。
import { codes, constants } from 'micromark-util-symbol'
import { classifyCharacter } from 'micromark-util-classify-character'
import { unicodePunctuation } from 'micromark-util-character'
import { attention } from 'micromark-core-commonmark'

const cjkCharacter = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u
function isCjkCharacter(code: number | null): boolean {
  return code !== null && code >= 0 && cjkCharacter.test(String.fromCodePoint(code))
}

interface MicromarkThis { parser: any; previous: number | null }
function tokenizeCjkFriendlyAttention(this: MicromarkThis, effects: any, ok: (code: number | null) => unknown, nok: (code: number | null) => unknown) {
  const configuredAttentionMarkers: unknown[] = this.parser.constructs.attentionMarkers.null
  if (configuredAttentionMarkers === undefined) throw new Error('micromark CommonMark attention markers are unavailable')
  const attentionMarkers = configuredAttentionMarkers
  const previous = this.previous
  const before = classifyCharacter(previous)
  let marker: number | null = null
  return start
  function start(code: number | null) {
    if (code !== codes.asterisk) return nok(code)
    marker = code
    effects.enter('attentionSequence')
    return inside(code)
  }
  function inside(code: number | null) {
    if (code === marker) { effects.consume(code); return inside }
    const token = effects.exit('attentionSequence')
    const after = classifyCharacter(code)
    const open = !after || (after === constants.characterGroupPunctuation && Boolean(before)) || attentionMarkers.includes(code)
    const commonMarkClose = !before || (before === constants.characterGroupPunctuation && Boolean(after)) || attentionMarkers.includes(previous)
    const cjkStrongClose = token.end.offset - token.start.offset >= 2 && previous !== null && unicodePunctuation(previous) && isCjkCharacter(code)
    const close = commonMarkClose || cjkStrongClose
    token._open = open
    token._close = close
    return ok(code)
  }
}

const cjkFriendlyAttention = { name: 'cjkFriendlyAttention', resolveAll: attention.resolveAll, tokenize: tokenizeCjkFriendlyAttention }
const cjkFriendlyStrongExtension = { text: { [codes.asterisk]: cjkFriendlyAttention } }

export function cjkFriendlyStrong(): any {
  return cjkFriendlyStrongExtension
}
