import type { Terminal } from '@xterm/xterm'
import { terminalThemes, type ThemeName } from './terminalThemes'

/** sessionId -> live xterm instance, used to route PTY output. */
const terminals = new Map<string, Terminal>()

export const terminalRegistry = {
  register(id: string, term: Terminal): void {
    terminals.set(id, term)
  },
  unregister(id: string): void {
    terminals.delete(id)
  },
  write(id: string, data: string): void {
    terminals.get(id)?.write(data)
  },
  /** Re-skin every live terminal (xterm re-renders on options change). */
  applyTheme(theme: ThemeName): void {
    for (const term of terminals.values()) {
      term.options.theme = terminalThemes[theme]
    }
  }
}
