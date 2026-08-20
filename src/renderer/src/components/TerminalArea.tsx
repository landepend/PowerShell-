import { useEffect } from 'react'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import { terminalRegistry } from '../terminalRegistry'
import { notifyOnSilence } from '../completionNotifier'
import { TerminalView } from './TerminalView'
import { EmptyState } from './EmptyState'

export function TerminalArea({ activeId }: { activeId: string | null }) {
  const sessions = useSessionStore((s) => s.sessions)

  // Route PTY output to the right xterm instance; flag output on background
  // sessions so the sidebar can show an activity badge.
  useEffect(() => {
    return api.onPtyData((id, data) => {
      terminalRegistry.write(id, data)
      notifyOnSilence(id)
      if (id !== useSessionStore.getState().activeSessionId) {
        useSessionStore.getState().markActivity(id)
      }
    })
  }, [])

  if (sessions.length === 0) {
    return <EmptyState />
  }

  return (
    <div className="terminal-area">
      {sessions.map((session) => (
        <TerminalView key={session.id} session={session} active={session.id === activeId} />
      ))}
    </div>
  )
}
