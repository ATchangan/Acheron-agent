// useThinkSelector.ts —— 聊天输入框推理强度 hook（从 ChatInput 拆出，行为不变）
import { useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { THINK_LABELS } from './chat-input-constants'

export function useThinkSelector(currentModel: string, curModelName: string) {
  const [think, setThink] = useState<string>(useSettingsStore.getState().general.thinkLevel || 'medium')
  const [thinkOnly, setThinkOnly] = useState(false)
  const [thinkOv, setThinkOv] = useState<Record<string, string>>(useSettingsStore.getState().general.thinkOverrides || {})
  const ovModel = curModelName || currentModel
  const effThink = thinkOnly && thinkOv[ovModel] ? thinkOv[ovModel] : think
  const thinkLabel = effThink === 'off' ? '关闭' : (THINK_LABELS[effThink] || '标准')
  const setThinkMode = (on: boolean) => {
    const next = on ? (think === 'off' ? 'medium' : think) : 'off'
    if (thinkOnly) {
      const ov = { ...thinkOv, [ovModel]: next }
      setThinkOv(ov)
      useSettingsStore.getState().updateGeneral({ thinkOverrides: ov })
    } else {
      useSettingsStore.getState().updateGeneral({ thinkLevel: next })
      setThink(next)
    }
  }
  const toggleThinkOnly = () => {
    const next = !thinkOnly
    setThinkOnly(next)
    const ov = { ...thinkOv }
    if (!next) {
      delete ov[ovModel]
    } else if (!ov[ovModel]) {
      ov[ovModel] = think === 'off' ? 'medium' : think
    }
    setThinkOv(ov)
    useSettingsStore.getState().updateGeneral({ thinkOverrides: ov })
  }
  const setThinkLevel = (k: string) => {
    if (thinkOnly) {
      const ov = { ...thinkOv, [ovModel]: k }
      setThinkOv(ov)
      useSettingsStore.getState().updateGeneral({ thinkOverrides: ov })
    } else {
      useSettingsStore.getState().updateGeneral({ thinkLevel: k })
      setThink(k)
    }
  }
  return { think, setThink, thinkOnly, effThink, thinkLabel, ovModel, setThinkMode, toggleThinkOnly, setThinkLevel }
}
