import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import { useChatStore } from '../chat-ui/store'
import { PROJECT_CLIS, SESSION_TYPES, type SessionState } from '../../../shared/types/session'

const STATUS_DOT: Record<SessionState['status'], string> = {
  starting: '◌',
  running: '●',
  exited: '○',
  error: '!'
}

/** One tab per terminal session: click to focus, double-click to rename,
 *  right-click for the full session menu (restart/pin/duplicate/close). */
function PaneTab({ session }: { session: SessionState }) {
  const active = useSessionStore((s) => s.activeSessionId === session.id)
  const renaming = useSessionStore((s) => s.renamingId === session.id)
  const lastActivity = useSessionStore((s) => s.activity[session.id])
  const projects = useSessionStore((s) => s.projects)
  const setRenaming = useSessionStore((s) => s.setRenaming)
  const openMenu = useSessionStore((s) => s.openMenu)
  const project = session.projectId ? projects.find((p) => p.id === session.projectId) : undefined
  const [draft, setDraft] = useState(session.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) {
      setDraft(session.name)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming, session.name])

  const commitRename = () => {
    if (draft.trim() && draft.trim() !== session.name) {
      void api.renameSession(session.id, draft.trim())
    }
    setRenaming(null)
  }

  return (
    <div
      className={`tp-tab${active ? ' active' : ''}`}
      title={session.cwd}
      onClick={() => void api.setActiveSession(session.id)}
      onDoubleClick={() => setRenaming(session.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
      }}
    >
      <span className={`status-dot ${session.status}`}>{STATUS_DOT[session.status]}</span>
      {renaming ? (
        <input
          ref={inputRef}
          className="rename-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename()
            if (e.key === 'Escape') setRenaming(null)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="tp-tab-name">{session.name}</span>
      )}
      {!active && lastActivity && <span className="activity-dot" title="有新输出" />}
      <button
        className="tp-tab-close"
        title="关闭会话"
        onClick={(e) => {
          e.stopPropagation()
          void api.closeSession(session.id)
        }}
      >
        ×
      </button>
    </div>
  )
}

/** Tab strip on top of the collapsible terminal pane. */
export function TerminalPaneBar() {
  const sessions = useSessionStore((s) => s.sessions)
  const setTerminalOpen = useChatStore((s) => s.setTerminalOpen)

  const newTerminal = () => {
    // New shells land in the active chat's project directory when there is one.
    const { view, chats } = useChatStore.getState()
    const chat = view.kind === 'chat' ? chats.find((c) => c.id === view.chatId) : undefined
    void api.createSession('powershell', undefined, chat?.cwd)
  }

  return (
    <div className="tp-bar">
      <div className="tp-tabs">
        {sessions.map((s) => (
          <PaneTab key={s.id} session={s} />
        ))}
        <button className="tp-add" title="新建终端" onClick={newTerminal}>
          ＋
        </button>
      </div>
      <button className="tp-collapse" title="隐藏终端面板" onClick={() => setTerminalOpen(false)}>
        »
      </button>
    </div>
  )
}
