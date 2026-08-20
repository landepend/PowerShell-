export type SessionType = 'kimi' | 'codex' | 'powershell'

export type SessionStatus = 'starting' | 'running' | 'exited' | 'error'

export type ThemeName = 'dark' | 'light'

/** CLIs a project can launch; extend PROJECT_CLIS to add more. */
export type CliKind = 'kimi' | 'claude' | 'codex'

export const PROJECT_CLIS: Record<CliKind, { label: string }> = {
  kimi: { label: 'Kimi' },
  claude: { label: 'Claude' },
  codex: { label: 'Codex' }
}

/** A project groups sessions: one folder + one CLI launch config. */
export interface ProjectMeta {
  id: string
  name: string
  cwd: string
  cli: CliKind
  /** Extra startup params, e.g. "-m kimi-code/kimi-for-coding --yolo". */
  args?: string
  /**
   * Full composed startup command (may include a PowerShell env prefix like
   * `$env:X='..'; claude ...`). When present it is used verbatim; otherwise
   * the launch falls back to `cli + args`.
   */
  commandLine?: string
  order: number
  collapsed?: boolean
  createdAt: string
}

/** Serializable session metadata — everything here lands in workspace.json. */
export interface SessionMeta {
  id: string
  name: string
  type: SessionType
  command: string
  cwd: string
  order: number
  createdAt: string
  lastActiveAt: string
  /**
   * CLI that was running inside this session's PowerShell when the app
   * closed (snapshotted at quit via process-tree scan), relaunched on the
   * next start. Only meaningful for type 'powershell'; for CLI-typed
   * sessions `command` already plays this role.
   */
  startupCommand?: string
  /** Project this session belongs to; launch config comes from the project. */
  projectId?: string
  /** Pinned sessions show in the global pinned section above all groups. */
  pinned?: boolean
  /**
   * Set once the name was chosen (manually or auto from the first prompt).
   * Project sessions without it are auto-named from the first submitted line.
   */
  nameLocked?: boolean
}

/** Runtime session state — metadata plus live process status (not persisted). */
export interface SessionState extends SessionMeta {
  status: SessionStatus
  exitCode?: number
  errorMessage?: string
}

export interface WorkspaceFile {
  version: number
  activeSessionId: string | null
  sessions: SessionMeta[]
  projects: ProjectMeta[]
  chats: import('./chat').ChatMeta[]
  /** App version that last wrote this file; used for upgrade backups. */
  appVersion?: string
  ui: {
    sidebarWidth: number
    theme: ThemeName
  }
}

/** Snapshot pushed from main process to renderer. */
export interface AppState {
  sessions: SessionState[]
  projects: ProjectMeta[]
  chats: import('./chat').ChatMeta[]
  activeSessionId: string | null
  sidebarWidth: number
  theme: ThemeName
}

export const SESSION_TYPES: Record<SessionType, { label: string; command: string }> = {
  kimi: { label: 'Kimi', command: 'kimi' },
  codex: { label: 'Codex', command: 'codex' },
  powershell: { label: 'PowerShell', command: 'powershell.exe' }
}

export const WORKSPACE_VERSION = 1
