import { api } from './api'
import { useSessionStore } from './stores/sessionStore'

/**
 * Auto-names project sessions from the first submitted prompt (Codex-style
 * task titles). Reconstructs the input line from raw PTY keystrokes; once a
 * session has a locked name (manual rename or a previous auto-name) tracking
 * stops for it.
 */

const buffers = new Map<string, string>()

const MAX_LEN = 30

function candidate(buffer: string): string | null {
  const firstLine = buffer.split('\n')[0].replace(/\s+/g, ' ').trim()
  if (firstLine.length < 2) return null
  return firstLine.length > MAX_LEN ? firstLine.slice(0, MAX_LEN) + '…' : firstLine
}

function eligible(id: string): boolean {
  const s = useSessionStore.getState().sessions.find((s) => s.id === id)
  return !!s && !!s.projectId && !s.nameLocked
}

/** Feed one chunk of user input going to the PTY. */
export function trackInput(id: string, data: string): void {
  if (!eligible(id)) {
    buffers.delete(id)
    return
  }
  let buf = buffers.get(id) ?? ''
  // Strip CSI / OSC escape sequences (arrows, history recall, focus events).
  const text = data
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
  for (const ch of text) {
    if (ch === '\r') {
      const name = candidate(buf)
      buf = ''
      if (name) {
        void api.renameSession(id, name)
        buffers.delete(id)
        return
      }
    } else if (ch === '\x7f' || ch === '\b') {
      buf = buf.slice(0, -1)
    } else if (ch === '\x03') {
      buf = '' // Ctrl+C clears the line
    } else if (ch >= ' ' || ch === '\n') {
      // printable (incl. CJK, which compares >= ' ') and our Ctrl+Enter newline
      buf += ch
    }
  }
  if (buf.length > 500) buf = buf.slice(-500)
  buffers.set(id, buf)
}
