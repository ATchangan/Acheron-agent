// useModelItems.ts —— 聊天输入框模型列表 hook（从 ChatInput 拆出，行为不变）
import { useState } from 'react'
import { useSettingsStore } from '../store/settings'
import { detectCaps } from './settings/consts'

export function useModelItems() {
  const providers = useSettingsStore(s => s.providers)
  const mediaProviders = useSettingsStore(s => s.mediaProviders || [])
  const classifyModel = (m: string): 'text' | 'image' | 'video' | 'audio' => {
    const caps = detectCaps([m])
    if (caps.includes('图片')) return 'image'
    if (caps.includes('视频')) return 'video'
    if (caps.includes('语音')) return 'audio'
    return 'text'
  }
  const cfgProviders = providers.filter(pp => !!pp.apiKey && (pp.models || []).length)
  const cfgMedia = mediaProviders.filter(mp => !!mp.apiKey)
  const modelItems: { key: string; label: string; group: 'text' | 'image' | 'video' | 'audio'; pid: string; model: string; isMedia: boolean }[] = []
  for (const pp of cfgProviders) for (const m of (pp.models || [])) {
    const g = classifyModel(m)
    modelItems.push({ key: g === 'text' ? pp.id + '::' + m : g + '::' + pp.id + '::' + m, label: m, group: g, pid: pp.id, model: m, isMedia: false })
  }
  for (const mp of cfgMedia) {
    const push = (ms: string[] | undefined, kind: 'image' | 'video' | 'audio') => (ms || []).forEach(m => modelItems.push({ key: kind + '::' + mp.id + '::' + m, label: m, group: kind, pid: mp.id, model: m, isMedia: true }))
    push(mp.imgModels, 'image')
    push(mp.videoModels, 'video')
    push(mp.audioModels, 'audio')
  }
  const models = modelItems.map(x => x.key)
  const gMain = useSettingsStore(s => (s.general).mainModel)
  const defaultKey = (gMain && models.includes(gMain)) ? gMain : (models[0] || '')
  const [modelSel, setModelSel] = useState(defaultKey)
  const currentModel = modelSel || defaultKey || '未配置'
  const curModelName = (currentModel.includes('::') ? currentModel.split('::').pop() : currentModel) || ''
  const supportsVision = !currentModel || currentModel === '未配置' || detectCaps([curModelName]).includes('多模态')
  return {
    mediaProviders,
    modelItems,
    models,
    currentModel,
    curModelName,
    setModelSel,
    supportsVision,
  }
}
