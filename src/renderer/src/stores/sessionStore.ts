import { create } from 'zustand'
import type { AppState, ProjectMeta, SessionState } from '../../../shared/types/session'

interface ContextMenuState {
  x: number
  y: number
  sessionId: string
}

interface SessionStore {
  sessions: SessionState[]
  projects: ProjectMeta[]
  activeSessionId: string | null
  sidebarWidth: number
  theme: 'dark' | 'light'
  renamingId: string | null
  menu: ContextMenuState | null
  settingsOpen: boolean
  /** sessionId -> last PTY output timestamp, for background-activity badges. */
  activity: Record<string, number>

  applyState(state: AppState): void
  setSidebarWidth(width: number): void
  markActivity(id: string): void
  setRenaming(id: string | null): void
  openMenu(menu: ContextMenuState): void
  closeMenu(): void
  setSettingsOpen(open: boolean): void
}

export const useSessionStore = create<SessionStore>()((set) => ({
  sessions: [],
  projects: [],
  activeSessionId: null,
  sidebarWidth: 220,
  theme: 'dark',
  renamingId: null,
  menu: null,
  settingsOpen: false,
  activity: {},

  applyState: (state) =>
    set((prev) => {
      // Drop badges of closed sessions and of the one being viewed.
      const activity: Record<string, number> = {}
      for (const s of state.sessions) {
        if (s.id !== state.activeSessionId && prev.activity[s.id]) {
          activity[s.id] = prev.activity[s.id]
        }
      }
      return {
        sessions: state.sessions,
        projects: state.projects,
        activeSessionId: state.activeSessionId,
        sidebarWidth: state.sidebarWidth,
        theme: state.theme,
        activity
      }
    }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  markActivity: (id) =>
    // Throttle: spinner-heavy TUIs produce dozens of chunks per second.
    set((prev) => {
      const now = Date.now()
      if (now - (prev.activity[id] ?? 0) < 400) return prev
      return { activity: { ...prev.activity, [id]: now } }
    }),
  setRenaming: (id) => set({ renamingId: id }),
  openMenu: (menu) => set({ menu }),
  closeMenu: () => set({ menu: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open })
}))
