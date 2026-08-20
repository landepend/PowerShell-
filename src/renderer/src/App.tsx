import { useCallback, useEffect, useRef } from 'react'
import { api } from './api'
import { useSessionStore } from './stores/sessionStore'
import { terminalRegistry } from './terminalRegistry'
import { Sidebar } from './components/Sidebar'
import { TerminalArea } from './components/TerminalArea'
import { ContextMenu } from './components/ContextMenu'
import { SettingsPage } from './components/SettingsPage'
import { initChatUi, useChatStore } from './chat-ui/store'
import { AppSidebar } from './chat-ui/AppSidebar'
import { HomePage } from './chat-ui/HomePage'
import { ChatView } from './chat-ui/ChatView'
import { ChatSettings } from './chat-ui/SettingsPage'
import './chat-ui/chat-ui.css'

const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 400

export default function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const theme = useSessionStore((s) => s.theme)
  const settingsOpen = useSessionStore((s) => s.settingsOpen)
  const view = useChatStore((s) => s.view)
  const resizingRef = useRef(false)

  // Chat UI layer: own state sync + streaming chat events
  useEffect(() => initChatUi(), [])

  // Initial state + live state sync from main process
  useEffect(() => {
    void api.getState().then((state) => useSessionStore.getState().applyState(state))
    return api.onStateChanged((state) => useSessionStore.getState().applyState(state))
  }, [])

  // Apply theme to the document chrome and all live terminals
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    terminalRegistry.applyTheme(theme)
  }, [theme])

  // Global shortcuts (capture phase so they win over the focused terminal)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Enter / Shift+Enter inside a terminal: send LF (kimi's Ctrl+J
      // newline) instead of letting xterm emit CR, which would submit.
      // Capture phase fires before the IME or xterm's textarea can consume it.
      if ((e.ctrlKey || e.shiftKey) && !e.altKey && e.key === 'Enter') {
        const host = (e.target as HTMLElement | null)?.closest?.('[data-session-id]')
        const sessionId = host?.getAttribute('data-session-id')
        if (sessionId) {
          e.preventDefault()
          e.stopPropagation()
          api.ptyInput(sessionId, '\n')
          return
        }
      }
      if (!e.ctrlKey || e.altKey) return
      const store = useSessionStore.getState()
      const key = e.key.toLowerCase()
      const ids = store.sessions.map((s) => s.id)
      const activeIndex = store.activeSessionId ? ids.indexOf(store.activeSessionId) : -1

      if (e.shiftKey && (key === 'n' || key === 'p')) {
        void api.createSession('powershell')
      } else if (!e.shiftKey && key === 'w') {
        if (store.activeSessionId) void api.closeSession(store.activeSessionId)
      } else if (key === 'tab' && ids.length > 1) {
        const dir = e.shiftKey ? -1 : 1
        const next = ids[(activeIndex + dir + ids.length) % ids.length]
        void api.setActiveSession(next)
      } else {
        return
      }
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  // Sidebar drag-resize (160px ~ 400px), persisted via workspace.json
  const startResize = useCallback(() => {
    resizingRef.current = true
    const onMove = (e: MouseEvent) => {
      if (!resizingRef.current) return
      const width = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX))
      useSessionStore.getState().setSidebarWidth(width)
    }
    const onUp = (e: MouseEvent) => {
      resizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const width = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX))
      api.setSidebarWidth(width)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // Chat shell covers home/chat views; settings opened from the chat UI stay
  // inside it (chat sidebar + Codex-style ChatSettings). The terminal view
  // keeps the old sidebar and SettingsPage. Chat views keep terminals mounted
  // (hidden) so PTYs keep running.
  const chatShell = view.kind !== 'terminal'
  const chatMain = chatShell && !settingsOpen

  return (
    <div className={chatShell ? 'app chat-ui' : 'app'}>
      <div className="sidebar-wrap" style={{ width: sidebarWidth }}>
        {chatShell ? <AppSidebar /> : <Sidebar />}
      </div>
      <div className="sidebar-resizer" onMouseDown={startResize} />
      <div className="terminal-wrap">
        {settingsOpen ? (
          chatShell ? (
            <ChatSettings />
          ) : (
            <SettingsPage />
          )
        ) : (
          <>
            {view.kind === 'home' && <HomePage />}
            {view.kind === 'chat' && <ChatView chatId={view.chatId} />}
            <div
              style={chatMain ? { display: 'none' } : { display: 'flex', flex: 1, minWidth: 0 }}
            >
              <TerminalArea activeId={activeSessionId} />
            </div>
          </>
        )}
      </div>
      <ContextMenu />
    </div>
  )
}
