// src/store/display.ts — 界面显示配置解析(纯函数, 默认全显示)
// 所有显隐开关都在这里收敛默认值, 组件只需 resolveDisplay(g.uiDisplay) 后按字段渲染。
import type { UiDisplayConfig } from '../types'

export interface ResolvedDisplay {
  hiddenNav: string[]
  hideSessionSearch: boolean
  hideSessionList: boolean
  hidePlanCards: boolean
  hideChatToolbar: boolean
  hideAttachmentBar: boolean
  hideModelPicker: boolean
  hideThinkSelector: boolean
  hideTokenUsage: boolean
  hideTimestamps: boolean
  hideToolCalls: boolean
  hideTokenMeta: boolean
  hideCopyButtons: boolean
  hideRegenerate: boolean
  statusLine: string
  density: 'compact' | 'comfortable' | 'spacious'
  customCss: string
}

export const CUSTOM_CSS_MAX = 64 * 1024

// 状态行模板: ${name} 插值, 不可用/未知值连同相邻多余空白一起消失
export interface StatusLineValues {
  workDir?: string
  model?: string
  context?: string
  tokens?: string
  agents?: string
}
export function compileStatusLine(template: string, values: StatusLineValues): string {
  return String(template || '')
    .replace(/\$\{(\w+)\}/g, (_, k: string) => (values as Record<string, string | undefined>)[k] || '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*[|·]\s*(?=[|·]|$)/g, ' ')
    .replace(/^\s*[|·]\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function resolveDisplay(cfg?: UiDisplayConfig): ResolvedDisplay {
  const hiddenNav = Array.isArray(cfg?.hiddenNav) ? cfg.hiddenNav.filter(v => typeof v === 'string') : []
  return {
    hiddenNav,
    hideSessionSearch: cfg?.hideSessionSearch === true,
    hideSessionList: cfg?.hideSessionList === true,
    hidePlanCards: cfg?.hidePlanCards === true,
    hideChatToolbar: cfg?.hideChatToolbar === true,
    hideAttachmentBar: cfg?.hideAttachmentBar === true,
    hideModelPicker: cfg?.hideModelPicker === true,
    hideThinkSelector: cfg?.hideThinkSelector === true,
    hideTokenUsage: cfg?.hideTokenUsage === true,
    hideTimestamps: cfg?.hideTimestamps === true,
    hideToolCalls: cfg?.hideToolCalls === true,
    hideTokenMeta: cfg?.hideTokenMeta === true,
    hideCopyButtons: cfg?.hideCopyButtons === true,
    hideRegenerate: cfg?.hideRegenerate === true,
    statusLine: typeof cfg?.statusLine === 'string' ? cfg.statusLine.slice(0, 500) : '',
    density: cfg?.density === 'compact' || cfg?.density === 'spacious' ? cfg.density : 'comfortable',
    customCss: typeof cfg?.customCss === 'string' ? cfg.customCss.slice(0, CUSTOM_CSS_MAX) : '',
  }
}
