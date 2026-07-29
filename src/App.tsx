import React, { useEffect, useState } from 'react'
import { useSettingsStore } from './store/settings'
import { useChatStore } from './store/chat'
import Sidebar from './components/Sidebar'
import ChatView from './components/ChatView'
import RightPanel from './components/RightPanel'
import SettingsView from './components/SettingsView'

export type View = 'chat' | 'settings'

export default function App() {
  const [view, setView] = useState<View>('chat')
  const theme = useSettingsStore(s => s.general.theme)

  useEffect(() => {
    useSettingsStore.getState().load()
    useChatStore.getState().load()
    document.documentElement.setAttribute('data-theme', theme || 'dark')
  }, [])

  return (
    <div className="app-shell">
      <Sidebar currentView={view} onNavigate={setView} />
      <div className="chat-main">
        {view === 'chat' ? <ChatView onNavigate={setView} /> : <SettingsView />}
      </div>
      {view === 'chat' && <RightPanel />}
    </div>
  )
}
