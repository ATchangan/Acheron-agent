// useChatPanels.ts —— 聊天输入框面板开关（从 ChatInput 拆出，行为不变）
import { useState } from 'react'

export function useChatPanels() {
  const [extraOpen, setExtraOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [memOpen, setMemOpen] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [thinkOpen, setThinkOpen] = useState(false)

  const closeAll = () => { setCmdOpen(false); setMemOpen(false); setPermOpen(false); setThinkOpen(false) }

  return {
    extraOpen, setExtraOpen,
    cmdOpen, setCmdOpen,
    memOpen, setMemOpen,
    permOpen, setPermOpen,
    thinkOpen, setThinkOpen,
    closeAll,
  }
}
