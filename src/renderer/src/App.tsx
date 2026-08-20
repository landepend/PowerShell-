import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import { useSessionStore } from './stores/sessionStore'
import { terminalRegistry } from './terminalRegistry'
import { TerminalArea } from './components/TerminalArea'
import { TerminalPaneBar } from './components/TerminalPaneBar'
import { ContextMenu } from './components/ContextMenu'
import { initChatUi, useChatStore } from './chat-ui/store'
import { AppSidebar } from './chat-ui/AppSidebar'
import { HomePage } from './chat-ui/HomePage'
import { ChatView } from './chat-ui/ChatView'
import { ChatSettings } from './chat-ui/SettingsPage'
import './chat-ui/chat-ui.css'

const MIN_SIDEBAR = 160
const MAX_SIDEBAR = 400
const MIN_TERM_PANE = 320

export default function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const sidebarWidth = useSessionStore((s) => s.sidebarWidth)
  const theme = useSessionStore((s) => s.theme)
  const settingsOpen = useSessionStore((s) => s.settingsOpen)
  const view = useChatStore((s) => s.view)
  const terminalOpen = useChatStore((s) => s.terminalOpen)
  const resizingRef = useRef(false)
  const termResizingRef = useRef(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('pss.sidebarCollapsed') === '1'
  )
  const [termWidth, setTermWidth] = useState(
    () => Number(localStorage.getItem('pss.termWidth')) || 460
  )

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
        useChatStore.getState().setTerminalOpen(true)
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

  // Terminal pane drag-resize (from its left edge), persisted in localStorage
  const startTermResize = useCallback(() => {
    termResizingRef.current = true
    const clamp = (v: number) =>
      Math.min(window.innerWidth - 480, Math.max(MIN_TERM_PANE, v))
    const onMove = (e: MouseEvent) => {
      if (!termResizingRef.current) return
      setTermWidth(clamp(window.innerWidth - e.clientX))
    }
    const onUp = (e: MouseEvent) => {
      termResizingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      localStorage.setItem('pss.termWidth', String(clamp(window.innerWidth - e.clientX)))
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem('pss.sidebarCollapsed', prev ? '0' : '1')
      return !prev
    })
  }

  // Single shell: title bar on top; below it sidebar | chat | terminal pane.
  // The terminal pane stays mounted while hidden so PTYs keep their buffers.
  return (
    <div className="app chat-ui">
      <div className="titlebar">
        <button
          className="titlebar-btn"
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          onClick={toggleSidebar}
        >
          ◧
        </button>
        <span className="titlebar-title">PowerShell++</span>
        <div className="titlebar-drag" />
        <button
          className={`titlebar-btn${terminalOpen ? ' active' : ''}`}
          title={terminalOpen ? '隐藏终端面板' : '显示终端面板'}
          onClick={() => useChatStore.getState().toggleTerminalPane()}
        >
          ▤
        </button>
      </div>
      <div className="app-body">
        {!sidebarCollapsed && (
          <>
            <div className="sidebar-wrap" style={{ width: sidebarWidth }}>
              <AppSidebar />
            </div>
            <div className="sidebar-resizer" onMouseDown={startResize} />
          </>
        )}
        <div className="chat-main">
          {settingsOpen ? (
            <ChatSettings />
          ) : view.kind === 'home' ? (
            <HomePage />
          ) : (
            <ChatView chatId={view.chatId} />
          )}
        </div>
        {terminalOpen && (
          <div className="terminal-pane-resizer" onMouseDown={startTermResize} />
        )}
        <div
          className="terminal-pane"
          style={terminalOpen ? { width: termWidth } : { display: 'none' }}
        >
          <TerminalPaneBar />
          <TerminalArea activeId={activeSessionId} />
        </div>
      </div>
      <ContextMenu />
    </div>
  )
}
