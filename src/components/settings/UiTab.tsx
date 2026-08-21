// src/components/settings/UiTab.tsx — 界面自定义(结构化显隐开关 + 信息密度 + 自定义 CSS)
import React from 'react'
import { useSettingsStore } from '../../store/settings'
import { C, S, Toggle } from '../settings-ui'
import { U } from '../ui-styles'
import type { UiDisplayConfig } from '../../types'
import { CUSTOM_CSS_MAX } from '../../store/display'

const NAV_OPTIONS: { key: 'agents' | 'browser' | 'files'; label: string }[] = [
  { key: 'agents', label: '角色编队' },
  { key: 'browser', label: '浏览器' },
  { key: 'files', label: '文件' },
]

export default function UiTab() {
  const d = useSettingsStore(s => s.general.uiDisplay) || {}
  const set = (patch: Partial<UiDisplayConfig>) => useSettingsStore.getState().updateGeneral({ uiDisplay: { ...d, ...patch } })
  const reset = () => useSettingsStore.getState().updateGeneral({ uiDisplay: undefined })
  const hiddenNav = Array.isArray(d.hiddenNav) ? d.hiddenNav : []
  const setNav = (key: string, show: boolean) => set({ hiddenNav: show ? hiddenNav.filter(k => k !== key) : [...new Set([...hiddenNav, key])] })

  return (
    <div style={U.pageBody}>
      <div style={S.card}>
        <div style={S.section}>侧边栏</div>
        <Toggle checked={!d.hideSessionSearch} onChange={v => set({ hideSessionSearch: !v })} label="会话搜索框" hint="隐藏侧边栏历史会话搜索" />
        <Toggle checked={!d.hideSessionList} onChange={v => set({ hideSessionList: !v })} label="会话列表" hint="隐藏聊天/工作模式切换与历史会话列表（纯聊天界面）" />
        {NAV_OPTIONS.map(o => (
          <Toggle key={o.key} checked={!hiddenNav.includes(o.key)} onChange={v => setNav(o.key, v)} label={'导航项：' + o.label} />
        ))}
      </div>

      <div style={S.card}>
        <div style={S.section}>聊天区</div>
        <Toggle checked={!d.hideChatToolbar} onChange={v => set({ hideChatToolbar: !v })} label="输入工具栏" hint="隐藏补充上下文/快捷指令/记忆/权限/上传按钮组" />
        <Toggle checked={!d.hideAttachmentBar} onChange={v => set({ hideAttachmentBar: !v })} label="附件预览条" hint="隐藏引用与图片/文件预览" />
        <Toggle checked={!d.hideModelPicker} onChange={v => set({ hideModelPicker: !v })} label="角色/模型选择器" hint="隐藏输入框右侧的角色与模型下拉" />
        <Toggle checked={!d.hideThinkSelector} onChange={v => set({ hideThinkSelector: !v })} label="推理强度选择器" hint="隐藏推理强度下拉，沿用当前设置" />
        <Toggle checked={!d.hideTokenUsage} onChange={v => set({ hideTokenUsage: !v })} label="Token 输出速度" hint="隐藏状态栏 Token 输出速度显示（上下文用量始终展示）" />
        <Toggle checked={!d.hidePlanCards} onChange={v => set({ hidePlanCards: !v })} label="执行计划卡" hint="隐藏任务顶部的计划/批准面板" />
      </div>

      <div style={S.card}>
        <div style={S.section}>消息元素</div>
        <Toggle checked={!d.hideTimestamps} onChange={v => set({ hideTimestamps: !v })} label="时间戳" hint="隐藏消息时间与相对时间" />
        <Toggle checked={!d.hideToolCalls} onChange={v => set({ hideToolCalls: !v })} label="工具调用行" hint="隐藏工具执行步骤（参数/结果可展开项）" />
        <Toggle checked={!d.hideTokenMeta} onChange={v => set({ hideTokenMeta: !v })} label="耗时/Token 徽标" hint="隐藏任务耗时与 token 消耗标签" />
        <Toggle checked={!d.hideCopyButtons} onChange={v => set({ hideCopyButtons: !v })} label="复制按钮" hint="隐藏消息与末条回复的复制按钮" />
        <Toggle checked={!d.hideRegenerate} onChange={v => set({ hideRegenerate: !v })} label="重新生成按钮" hint="隐藏消息悬停的重新生成入口" />
      </div>

      <div style={S.card}>
        <div style={S.section}>信息密度</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['compact', 'comfortable', 'spacious'] as const).map(k => (
            <button key={k} onClick={() => set({ density: k })} style={{
              flex: 1, padding: '8px 12px', borderRadius: 7, cursor: 'pointer',
              border: '1px solid ' + ((d.density || 'comfortable') === k ? C.accent : C.border),
              background: (d.density || 'comfortable') === k ? C.accentBg : 'transparent',
              color: (d.density || 'comfortable') === k ? C.text : C.muted,
              fontSize: 'calc(var(--ui-font-size) - 2px)', fontWeight: (d.density || 'comfortable') === k ? 700 : 400,
            }}>
              {k === 'compact' ? '紧凑' : k === 'comfortable' ? '舒适' : '宽松'}
            </button>
          ))}
        </div>
        <div style={S.hint}>控制消息间距；其余任意间距可用下方自定义 CSS 精调（data-density 属性为 compact/comfortable/spacious）。</div>
      </div>

      <div style={S.card}>
        <div style={S.section}>状态行模板（高级）</div>
        <div style={S.hint}>用 ${'{'}name{'}'} 插值自由组合聊天头部显示内容，可用：${'{'}workDir{'}'} 工作目录、${'{'}model{'}'} 当前模型、${'{'}context{'}'} 上下文用量、${'{'}tokens{'}'} 累计输入/输出、${'{'}agents{'}'} 活跃角色。留空则使用默认布局。</div>
        <input
          value={d.statusLine || ''}
          onChange={e => set({ statusLine: e.target.value.slice(0, 500) })}
          placeholder="例如: ${model} · ${workDir} · ${context} · ${tokens}"
          style={{ ...S.inp, marginTop: 10, fontFamily: 'Consolas, "Courier New", monospace' }}
        />
      </div>

      <div style={S.card}>
        <div style={S.section}>自定义 CSS（高级）</div>
        <div style={S.hint}>任意可显示元素都可通过 CSS 覆写（变量如 --accent/--bg-card/--ui-font-size/--chat-max-width，类名见界面源码）。最长 {Math.round(CUSTOM_CSS_MAX / 1024)}KB，保存即时生效。</div>
        <textarea
          value={d.customCss || ''}
          onChange={e => set({ customCss: e.target.value.slice(0, CUSTOM_CSS_MAX) })}
          placeholder={`/* 例: 隐藏消息操作栏 */\n.hq-msg-actions { display: none; }`}
          spellCheck={false}
          style={{
            width: '100%', height: 180, marginTop: 10, resize: 'vertical',
            background: C.input, border: '1px solid ' + C.border, borderRadius: 7,
            color: C.text, fontSize: 'calc(var(--code-font-size, 12px))', fontFamily: 'Consolas, "Courier New", monospace',
            padding: 10, boxSizing: 'border-box', outline: 'none', whiteSpace: 'pre', lineHeight: 1.5,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
          <span style={S.hint}>已用 {String(d.customCss || '').length} / {CUSTOM_CSS_MAX} 字符</span>
          <button style={S.btn('danger')} onClick={reset}>恢复默认界面</button>
        </div>
      </div>
    </div>
  )
}
