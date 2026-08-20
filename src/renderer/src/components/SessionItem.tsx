import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import { PROJECT_CLIS, SESSION_TYPES, type SessionState } from '../../../shared/types/session'

const STATUS_DOT: Record<SessionState['status'], string> = {
  starting: '◌',
  running: '●',
  exited: '○',
  error: '!'
}

export function SessionItem({ session }: { session: SessionState }) {
  const active = useSessionStore((s) => s.activeSessionId === session.id)
  const renaming = useSessionStore((s) => s.renamingId === session.id)
  const lastActivity = useSessionStore((s) => s.activity[session.id])
  const projects = useSessionStore((s) => s.projects)
  const setRenaming = useSessionStore((s) => s.setRenaming)
  const openMenu = useSessionStore((s) => s.openMenu)
  const project = session.projectId
    ? projects.find((p) => p.id === session.projectId)
    : undefined
  const [draft, setDraft] = useState(session.name)
  // Re-render once when the "live" window (2s since last output) expires,
  // so the badge falls back from pulsing to a static unread dot.
  const [now, setNow] = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!lastActivity) return
    const remain = lastActivity + 2000 - Date.now()
    if (remain <= 0) return
    const t = setTimeout(() => setNow(Date.now()), remain + 20)
    return () => clearTimeout(t)
  }, [lastActivity])

  useEffect(() => {
    if (renaming) {
      setDraft(session.name)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renaming, session.name])

  const commitRename = () => {
    if (draft.trim() && draft.trim() !== session.name) {
      void api.renameSession(session.id, draft)
    }
    setRenaming(null)
  }

  return (
    <div
      className={`session-item${active ? ' active' : ''}`}
      onClick={() => void api.setActiveSession(session.id)}
      onDoubleClick={() => setRenaming(session.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        openMenu({ x: e.clientX, y: e.clientY, sessionId: session.id })
      }}
      title={session.cwd}
    >
      <span className={`status-dot ${session.status}`}>{STATUS_DOT[session.status]}</span>
      <div className="session-meta">
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
          <div className="session-name">
            {session.pinned && <span className="pin-badge">📌</span>}
            {session.name}
          </div>
        )}
        <div className="session-type">
          {project ? PROJECT_CLIS[project.cli].label : SESSION_TYPES[session.type].label}
          {session.status === 'exited' && <span className="session-hint"> · 已退出</span>}
          {session.status === 'error' && <span className="session-hint error"> · 错误</span>}
        </div>
      </div>
      {!active && lastActivity && (
        <span
          className={`activity-dot${now - lastActivity < 2000 ? ' live' : ''}`}
          title={now - lastActivity < 2000 ? '正在输出' : '有新输出'}
        />
      )}
      <button
        className="session-close"
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
