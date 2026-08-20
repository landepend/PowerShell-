import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import type { ProjectMeta, SessionMeta, WorkspaceFile } from '../../shared/types/session'
import { PROJECT_CLIS, WORKSPACE_VERSION } from '../../shared/types/session'
import type { ChatMeta } from '../../shared/types/chat'
import type { Logger } from '../logger'

const VALID_TYPES = new Set(['kimi', 'codex', 'powershell'])

function normalizeSession(raw: unknown, index: number, seenIds: Set<string>): SessionMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || seenIds.has(r.id)) return null
  seenIds.add(r.id)
  const now = new Date().toISOString()
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'Terminal',
    type: VALID_TYPES.has(r.type as string) ? (r.type as SessionMeta['type']) : 'powershell',
    command: typeof r.command === 'string' && r.command ? r.command : 'powershell.exe',
    cwd: typeof r.cwd === 'string' && r.cwd ? r.cwd : (process.env.USERPROFILE ?? 'C:\\'),
    order: typeof r.order === 'number' ? r.order : index,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    lastActiveAt: typeof r.lastActiveAt === 'string' ? r.lastActiveAt : now,
    startupCommand:
      typeof r.startupCommand === 'string' && r.startupCommand ? r.startupCommand : undefined,
    projectId: typeof r.projectId === 'string' && r.projectId ? r.projectId : undefined,
    pinned: r.pinned === true ? true : undefined,
    nameLocked: r.nameLocked === true ? true : undefined
  }
}

function normalizeProject(raw: unknown, index: number, seenIds: Set<string>): ProjectMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || seenIds.has(r.id)) return null
  if (typeof r.cwd !== 'string' || !r.cwd) return null
  if (typeof r.cli !== 'string' || !(r.cli in PROJECT_CLIS)) return null
  seenIds.add(r.id)
  return {
    id: r.id,
    name: typeof r.name === 'string' && r.name ? r.name : 'Project',
    cwd: r.cwd,
    cli: r.cli as ProjectMeta['cli'],
    args: typeof r.args === 'string' && r.args ? r.args : undefined,
    commandLine:
      typeof r.commandLine === 'string' && r.commandLine ? r.commandLine : undefined,
    order: typeof r.order === 'number' ? r.order : index,
    collapsed: r.collapsed === true ? true : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString()
  }
}

function normalizeChat(raw: unknown, seenIds: Set<string>): ChatMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || seenIds.has(r.id)) return null
  seenIds.add(r.id)
  const now = new Date().toISOString()
  return {
    id: r.id,
    title: typeof r.title === 'string' && r.title ? r.title : '新对话',
    cwd: typeof r.cwd === 'string' && r.cwd ? r.cwd : (process.env.USERPROFILE ?? 'C:\\'),
    projectId: typeof r.projectId === 'string' && r.projectId ? r.projectId : undefined,
    kimiSessionId:
      typeof r.kimiSessionId === 'string' && r.kimiSessionId ? r.kimiSessionId : undefined,
    model: typeof r.model === 'string' && r.model ? r.model : undefined,
    effort: typeof r.effort === 'string' && r.effort ? r.effort : undefined,
    pinned: r.pinned === true ? true : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : now,
    lastActiveAt: typeof r.lastActiveAt === 'string' ? r.lastActiveAt : now
  }
}

/**
 * Loads/saves workspace.json. Saves are debounced and atomic
 * (write .tmp -> rename, keep .backup.json of the last good file).
 * A corrupted workspace never prevents the app from starting.
 */
export class WorkspaceManager {
  private readonly file: string
  private readonly backupFile: string
  private readonly data: WorkspaceFile
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    private readonly dir: string,
    private readonly logger: Logger,
    private readonly appVersion?: string
  ) {
    this.file = join(dir, 'workspace.json')
    this.backupFile = join(dir, 'workspace.backup.json')
    mkdirSync(dir, { recursive: true })
    this.backupOnUpgrade()
    this.data = this.load()
    this.data.appVersion = appVersion
  }

  /**
   * First start on a new app version: keep a one-shot copy of the previous
   * workspace as workspace.v<oldVersion>.bak.json. Session data lives in the
   * userData dir so installers never touch it; this is the extra safety net.
   */
  private backupOnUpgrade(): void {
    try {
      if (!this.appVersion || !existsSync(this.file)) return
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { appVersion?: string }
      const old = raw.appVersion
      if (old === this.appVersion) return
      const bak = join(this.dir, `workspace.v${old ?? 'unknown'}.bak.json`)
      copyFileSync(this.file, bak)
      this.logger.log('Workspace Backup (upgrade)', `${old ?? 'unknown'} -> ${this.appVersion}`)
    } catch {
      // corrupted file: load() already falls back to the backup copy
    }
  }

  get state(): WorkspaceFile {
    return this.data
  }

  private load(): WorkspaceFile {
    const main = this.readWorkspace(this.file)
    if (main) {
      this.logger.log('Workspace Load', `${this.file} (${main.sessions.length} sessions)`)
      return main
    }
    const backup = this.readWorkspace(this.backupFile)
    if (backup) {
      this.logger.log('Workspace Load (backup)', this.backupFile)
      return backup
    }
    this.logger.log('Workspace Load', 'no existing workspace, starting empty')
    return this.empty()
  }

  private empty(): WorkspaceFile {
    return {
      version: WORKSPACE_VERSION,
      activeSessionId: null,
      sessions: [],
      projects: [],
      chats: [],
      ui: { sidebarWidth: 220, theme: 'dark' }
    }
  }

  private readWorkspace(file: string): WorkspaceFile | null {
    try {
      if (!existsSync(file)) return null
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (!raw || !Array.isArray(raw.sessions)) return null
      const seenIds = new Set<string>()
      const sessions = raw.sessions
        .map((s, i) => normalizeSession(s, i, seenIds))
        .filter((s): s is SessionMeta => s !== null)
        .sort((a, b) => a.order - b.order)
      sessions.forEach((s, i) => (s.order = i))
      const seenProjectIds = new Set<string>()
      const projects = (Array.isArray(raw.projects) ? raw.projects : [])
        .map((p, i) => normalizeProject(p, i, seenProjectIds))
        .filter((p): p is ProjectMeta => p !== null)
        .sort((a, b) => a.order - b.order)
      projects.forEach((p, i) => (p.order = i))
      // Drop dangling project references so sessions fall back to ungrouped.
      for (const s of sessions) {
        if (s.projectId && !seenProjectIds.has(s.projectId)) s.projectId = undefined
      }
      const ui = raw.ui as Record<string, unknown> | undefined
      const sidebarWidth =
        typeof ui?.sidebarWidth === 'number' ? Math.min(400, Math.max(160, ui.sidebarWidth)) : 220
      const theme = ui?.theme === 'light' ? ('light' as const) : ('dark' as const)
      const activeSessionId =
        typeof raw.activeSessionId === 'string' && sessions.some((s) => s.id === raw.activeSessionId)
          ? raw.activeSessionId
          : null
      const seenChatIds = new Set<string>()
      const chats = (Array.isArray(raw.chats) ? raw.chats : [])
        .map((c) => normalizeChat(c, seenChatIds))
        .filter((c): c is ChatMeta => c !== null)
      return {
        version: WORKSPACE_VERSION,
        activeSessionId,
        sessions,
        projects,
        chats,
        ui: { sidebarWidth, theme }
      }
    } catch (err) {
      this.logger.error(`Workspace Parse ${file}`, err)
      return null
    }
  }

  /** Mutate the workspace and schedule a debounced save. */
  update(mutate: (data: WorkspaceFile) => void): void {
    mutate(this.data)
    this.scheduleSave()
  }

  scheduleSave(delay = 500): void {
    this.dirty = true
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flush(), delay)
  }

  /** Write immediately if there are pending changes (safe to call on quit). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    this.dirty = false
    const tmp = this.file + '.tmp'
    try {
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8')
      if (existsSync(this.file)) copyFileSync(this.file, this.backupFile)
      renameSync(tmp, this.file)
      this.logger.log('Workspace Save', `${this.data.sessions.length} sessions`)
    } catch (err) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp)
      } catch {
        // ignore
      }
      this.logger.error('Workspace Save', err)
    }
  }
}
