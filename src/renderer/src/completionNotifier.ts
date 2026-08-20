import { api } from './api'
import { useSessionStore } from './stores/sessionStore'

/**
 * Background-task completion notifier. PTY output keeps resetting a per-session
 * silence timer; when a session stays quiet for SILENCE_MS the task running in
 * it is considered finished. If the window is unfocused at that moment the
 * user cannot see any session, so fire a system notification regardless of
 * which session it is.
 */
const SILENCE_MS = 3000

const timers = new Map<string, ReturnType<typeof setTimeout>>()

function fire(id: string): void {
  timers.delete(id)
  if (document.hasFocus()) return
  const session = useSessionStore.getState().sessions.find((s) => s.id === id)
  if (!session || session.status !== 'running') return
  const notification = new Notification('任务完成', { body: session.name })
  notification.onclick = () => {
    api.focusWindow()
    void api.setActiveSession(id)
  }
}

/** Call on every PTY data chunk for a session. */
export function notifyOnSilence(id: string): void {
  const existing = timers.get(id)
  if (existing) clearTimeout(existing)
  timers.set(id, setTimeout(() => fire(id), SILENCE_MS))
}
