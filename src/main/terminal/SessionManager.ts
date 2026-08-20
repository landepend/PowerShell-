import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import type {
  AppState,
  ProjectMeta,
  SessionMeta,
  SessionState,
  SessionStatus,
  SessionType,
  ThemeName
} from '../../shared/types/session'
import { SESSION_TYPES } from '../../shared/types/session'
import type { CreateProjectInput, CreateSessionResult } from '../../shared/types/api'
import type { Logger } from '../logger'
import type { WorkspaceManager } from '../workspace/WorkspaceManager'
import type { PtyManager } from './PtyManager'
import type { ShellIntegration } from './ShellIntegration'
import { detectRunningClis } from './RunningCliDetector'

interface Deps {
  workspace: WorkspaceManager
  pty: PtyManager
  shellIntegration: ShellIntegration
  logger: Logger
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where.exe', [command], { timeout: 5000 }, (err) => resolve(!err))
  })
}

function toMeta(s: SessionState): SessionMeta {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    command: s.command,
    cwd: s.cwd,
    order: s.order,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    startupCommand: s.startupCommand,
    projectId: s.projectId,
    pinned: s.pinned,
    nameLocked: s.nameLocked
  }
}

/**
 * Single source of truth for sessions. UI never touches PTYs directly.
 * Owns: create / close / restart / rename / duplicate / switch /
 *       updateCwd / reorder — and mirrors everything into workspace.json.
 */
export class SessionManager {
  private sessions: SessionState[] = []
  private activeSessionId: string | null = null

  constructor(
    private readonly deps: Deps,
    private readonly onStateChanged: (state: AppState) => void
  ) {}

  // ---------- lifecycle ----------

  /** Recreate every session from workspace.json (dynamic count, dynamic cwd). */
  restore(): void {
    const ws = this.deps.workspace.state
    const metas = [...ws.sessions].sort((a, b) => a.order - b.order)
    this.sessions = metas.map((m, i) => ({ ...m, order: i, status: 'starting' as SessionStatus }))
    this.activeSessionId =
      ws.activeSessionId && this.sessions.some((s) => s.id === ws.activeSessionId)
        ? ws.activeSessionId
        : (this.sessions[0]?.id ?? null)
    this.deps.logger.log('Sessions Restore', `${this.sessions.length} sessions`)
    this.pushState()
    for (const session of this.sessions) void this.spawn(session)
  }

  /**
   * Snapshot the CLI running inside each live session (kimi/codex/claude)
   * into startupCommand, then flush and kill everything. Async because the
   * snapshot spawns one short-lived powershell.exe process-table scan.
   */
  async shutdown(): Promise<void> {
    const pidById = new Map<string, number>()
    for (const s of this.sessions) {
      if (s.status === 'running' || s.status === 'starting') {
        const pid = this.deps.pty.pid(s.id)
        if (pid) pidById.set(s.id, pid)
      }
    }
    const found = await detectRunningClis([...pidById.values()], this.deps.logger)
    for (const s of this.sessions) {
      // Project sessions restore from the project's CLI config, not a snapshot.
      if (s.projectId) continue
      const pid = pidById.get(s.id)
      const cli = pid ? found.get(pid) : undefined
      if (s.startupCommand !== cli) {
        s.startupCommand = cli
        if (cli) this.deps.logger.log('Session CLI Snapshot', `${s.id} -> ${cli}`)
      }
    }
    this.persist()
    this.deps.workspace.flush()
    this.deps.pty.killAll()
    this.deps.logger.log('Application Shutdown')
  }

  getState(): AppState {
    return {
      sessions: this.sessions.map((s) => ({ ...s })),
      projects: this.deps.workspace.state.projects.map((p) => ({ ...p })),
      chats: this.deps.workspace.state.chats.map((c) => ({ ...c })),
      activeSessionId: this.activeSessionId,
      sidebarWidth: this.deps.workspace.state.ui.sidebarWidth,
      theme: this.deps.workspace.state.ui.theme
    }
  }

  // ---------- session operations ----------

  async create(type: SessionType, name?: string, cwd?: string): Promise<CreateSessionResult> {
    const def = SESSION_TYPES[type]
    const finalCwd = cwd?.trim() || this.defaultCwd()
    const now = new Date().toISOString()
    const session: SessionState = {
      id: this.nextId(),
      name: name?.trim() || def.label,
      type,
      command: def.command,
      cwd: finalCwd,
      order: this.sessions.length,
      createdAt: now,
      lastActiveAt: now,
      status: 'starting'
    }
    this.sessions.push(session)
    this.activeSessionId = session.id
    this.persist()
    this.pushState()
    this.deps.logger.log('Session Created', `${session.id} ${type} @ ${session.cwd}`)
    await this.spawn(session)
    return { ok: session.status !== 'error', session: { ...session }, error: session.errorMessage }
  }

  /** Create a project (folder + CLI config) and its first session. */
  async createProject(input: CreateProjectInput): Promise<CreateSessionResult> {
    const cwd = input.cwd?.trim()
    if (!cwd || !existsSync(cwd)) return { ok: false, error: `目录不存在: ${input.cwd}` }
    const project: ProjectMeta = {
      id: this.nextProjectId(),
      name: input.name?.trim() || (cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? cwd),
      cwd,
      cli: input.cli,
      commandLine: input.commandLine?.trim() || undefined,
      order: this.deps.workspace.state.projects.length,
      createdAt: new Date().toISOString()
    }
    this.deps.workspace.update((d) => {
      d.projects.push(project)
    })
    this.deps.logger.log('Project Created', `${project.id} ${project.cli} @ ${cwd}`)
    return this.createProjectSession(project, project.name)
  }

  /** Add another session to an existing project, reusing its CLI config. */
  async createInProject(projectId: string): Promise<CreateSessionResult> {
    const project = this.findProject(projectId)
    if (!project) return { ok: false, error: '项目不存在' }
    const count = this.sessions.filter((s) => s.projectId === projectId).length
    const name = count === 0 ? project.name : `${project.name} ${count + 1}`
    return this.createProjectSession(project, name)
  }

  /** Only empty projects can be deleted; sessions keep the project alive. */
  deleteProject(projectId: string): void {
    if (this.sessions.some((s) => s.projectId === projectId)) return
    this.deps.workspace.update((d) => {
      d.projects = d.projects.filter((p) => p.id !== projectId)
      d.projects.forEach((p, i) => (p.order = i))
    })
    this.deps.logger.log('Project Deleted', projectId)
    this.pushState()
  }

  toggleProjectCollapsed(projectId: string): void {
    this.deps.workspace.update((d) => {
      const p = d.projects.find((p) => p.id === projectId)
      if (p) p.collapsed = !p.collapsed || undefined
    })
    this.pushState()
  }

  togglePin(id: string): void {
    const session = this.find(id)
    if (!session) return
    session.pinned = !session.pinned || undefined
    this.persist()
    this.pushState()
  }

  private async createProjectSession(
    project: ProjectMeta,
    name: string
  ): Promise<CreateSessionResult> {
    const now = new Date().toISOString()
    const session: SessionState = {
      id: this.nextId(),
      name,
      type: 'powershell',
      command: SESSION_TYPES.powershell.command,
      cwd: project.cwd,
      order: this.sessions.length,
      createdAt: now,
      lastActiveAt: now,
      status: 'starting',
      projectId: project.id
    }
    this.sessions.push(session)
    this.activeSessionId = session.id
    this.persist()
    this.pushState()
    this.deps.logger.log('Session Created', `${session.id} project=${project.id} @ ${project.cwd}`)
    await this.spawn(session)
    return { ok: session.status !== 'error', session: { ...session }, error: session.errorMessage }
  }

  private findProject(projectId: string): ProjectMeta | undefined {
    return this.deps.workspace.state.projects.find((p) => p.id === projectId)
  }

  private nextProjectId(): string {
    let max = 0
    for (const p of this.deps.workspace.state.projects) {
      const m = /^project_(\d+)$/.exec(p.id)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `project_${String(max + 1).padStart(3, '0')}`
  }

  close(id: string): void {
    const index = this.sessions.findIndex((s) => s.id === id)
    if (index === -1) return
    this.deps.pty.kill(id)
    this.sessions.splice(index, 1)
    this.reassignOrders()
    if (this.activeSessionId === id) {
      const next = this.sessions[Math.min(index, this.sessions.length - 1)]
      this.activeSessionId = next?.id ?? null
    }
    this.deps.logger.log('Session Closed', id)
    this.persist()
    this.pushState()
  }

  async restart(id: string): Promise<void> {
    const session = this.find(id)
    if (!session) return
    this.deps.pty.kill(id)
    session.status = 'starting'
    session.exitCode = undefined
    session.errorMessage = undefined
    this.deps.logger.log('Session Restart', id)
    this.pushState()
    await this.spawn(session, true)
  }

  rename(id: string, name: string): void {
    const session = this.find(id)
    const trimmed = name.trim()
    if (!session || !trimmed || session.name === trimmed) return
    session.name = trimmed
    session.nameLocked = true
    this.persist()
    this.pushState()
  }

  async duplicate(id: string): Promise<void> {
    const source = this.find(id)
    if (!source) return
    const now = new Date().toISOString()
    const copy: SessionState = {
      ...toMeta(source),
      id: this.nextId(),
      order: source.order + 1,
      createdAt: now,
      lastActiveAt: now,
      status: 'starting'
    }
    this.sessions.splice(this.sessions.indexOf(source) + 1, 0, copy)
    this.reassignOrders()
    this.deps.logger.log('Session Duplicated', `${source.id} -> ${copy.id}`)
    this.persist()
    this.pushState()
    await this.spawn(copy)
  }

  setActive(id: string): void {
    const session = this.find(id)
    if (!session || this.activeSessionId === id) return
    this.activeSessionId = id
    session.lastActiveAt = new Date().toISOString()
    this.persist()
    this.pushState()
  }

  /** cwd report from shell integration (OSC 9;9). */
  reportCwd(id: string, cwd: string): void {
    const session = this.find(id)
    const cleaned = cwd.trim()
    if (!session || !cleaned || session.cwd === cleaned) return
    session.cwd = cleaned
    this.persist()
    this.pushState()
  }

  reorder(orderedIds: string[]): void {
    if (orderedIds.length !== this.sessions.length) return
    const byId = new Map(this.sessions.map((s) => [s.id, s]))
    if (!orderedIds.every((id) => byId.has(id))) return
    this.sessions = orderedIds.map((id) => byId.get(id)!)
    this.reassignOrders()
    this.persist()
    this.pushState()
  }

  /** Error recovery: turn a failed session into a plain PowerShell session. */
  async openAsPowershell(id: string): Promise<void> {
    const session = this.find(id)
    if (!session) return
    session.type = 'powershell'
    session.command = SESSION_TYPES.powershell.command
    // Don't re-attempt the CLI that just failed on the next start.
    session.startupCommand = undefined
    this.persist()
    await this.restart(id)
  }

  setSidebarWidth(width: number): void {
    const clamped = Math.round(Math.min(400, Math.max(160, width)))
    this.deps.workspace.update((d) => {
      d.ui.sidebarWidth = clamped
    })
  }

  setTheme(theme: ThemeName): void {
    if (theme !== 'dark' && theme !== 'light') return
    this.deps.workspace.update((d) => {
      d.ui.theme = theme
    })
    this.pushState()
  }

  defaultCwd(): string {
    const active = this.activeSessionId ? this.find(this.activeSessionId) : undefined
    return active?.cwd ?? homedir()
  }

  // ---------- terminal IO ----------

  input(id: string, data: string): void {
    this.deps.pty.write(id, data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.deps.pty.resize(id, cols, rows)
  }

  attachTerminal(id: string): string {
    return this.deps.pty.attach(id)
  }

  // ---------- internals ----------

  private async spawn(session: SessionState, isRespawn = false): Promise<void> {
    // CLI availability check for external CLIs (kimi / codex)
    if (session.type !== 'powershell') {
      const found = await commandExists(session.command)
      if (!found) {
        session.status = 'error'
        session.errorMessage = `${SESSION_TYPES[session.type].label} CLI not found: "${session.command}" is not in PATH.`
        this.deps.logger.log('Session CLI Missing', `${session.id} ${session.command}`)
        this.pushState()
        return
      }
    }
    // cwd may have been deleted between runs; fall back so the app still starts
    let cwd = session.cwd
    if (!existsSync(cwd)) {
      this.deps.logger.log('Session Cwd Missing', `${session.id} ${cwd}`)
      cwd = homedir()
    }
    // What runs inside the shell on start: project sessions launch the
    // project's CLI config; CLI-typed sessions launch their command;
    // PowerShell sessions relaunch whatever CLI was snapshotted at the last
    // quit (e.g. kimi was running when the app closed).
    // Any kimi invocation (bare, with args, or behind an env prefix like
    // `$env:X='y'; kimi ...`) relaunches with `--continue` appended so the
    // most recent conversation in this cwd comes back instead of a fresh
    // session. Skipped when the command already resumes/prints
    // (--continue / --session / -p) or runs a subcommand (kimi web …).
    const project = session.projectId ? this.findProject(session.projectId) : undefined
    let startup: string | undefined
    if (project) {
      startup =
        project.commandLine ?? (project.args ? `${project.cli} ${project.args}` : project.cli)
    } else {
      startup = session.type === 'powershell' ? session.startupCommand : session.command
    }
    if (
      startup &&
      /(?:^|;\s*)kimi(?:\s|$)/.test(startup) &&
      !/--continue|--session\b|--prompt\b|\s-p(?:\s|$)/.test(startup) &&
      !/(?:^|;\s*)kimi\s+(?:export|provider|acp|web|server|login|doctor|vis|migrate|upgrade|update)\b/.test(
        startup
      )
    ) {
      startup = `${startup} --continue`
    }
    const args = this.deps.shellIntegration.spawnArgs(startup)
    try {
      const onExit = (exitCode: number) => {
        if (!this.find(session.id)) return
        session.status = 'exited'
        session.exitCode = exitCode
        this.pushState()
      }
      if (isRespawn) {
        this.deps.pty.respawn(session.id, 'powershell.exe', args, cwd, onExit)
      } else {
        this.deps.pty.create(session.id, 'powershell.exe', args, cwd, onExit)
      }
      session.status = 'running'
    } catch (err) {
      session.status = 'error'
      session.errorMessage = err instanceof Error ? err.message : String(err)
    }
    this.pushState()
  }

  private nextId(): string {
    let max = 0
    for (const s of this.sessions) {
      const m = /^session_(\d+)$/.exec(s.id)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `session_${String(max + 1).padStart(3, '0')}`
  }

  private find(id: string): SessionState | undefined {
    return this.sessions.find((s) => s.id === id)
  }

  private reassignOrders(): void {
    this.sessions.forEach((s, i) => (s.order = i))
  }

  private persist(): void {
    const sessions = this.sessions.map(toMeta)
    const activeId = this.activeSessionId
    this.deps.workspace.update((d) => {
      d.sessions = sessions
      d.activeSessionId = activeId
    })
  }

  private pushState(): void {
    this.onStateChanged(this.getState())
  }
}
