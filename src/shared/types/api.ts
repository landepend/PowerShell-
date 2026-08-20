import type { AppState, CliKind, SessionState, SessionType, ThemeName } from './session'
import type { ChatAttachment, ChatEvent, ChatMessage, ChatMeta, CreateChatInput, SendChatResult } from './chat'

export interface CreateSessionResult {
  ok: boolean
  error?: string
  session?: SessionState
}

export interface CreateProjectInput {
  name?: string
  cwd: string
  cli: CliKind
  /** Full startup command composed by the dialog (flags, env prefix, ...). */
  commandLine?: string
}

/** A model choice shown in the create-project dialog (read from local CLI config). */
export interface CliModelOption {
  value: string
  label: string
  /** Thinking effort levels the model accepts (kimi k3 family: low/high/max). */
  efforts?: string[]
  defaultEffort?: string
}

/** One quota line from the kimi usage API, e.g. weekly limit or 5h window. */
export interface UsageLimit {
  label: string
  used: number
  limit: number
  resetHint?: string
}

export type KimiUsageResult =
  | { kind: 'ok'; summary: UsageLimit | null; limits: UsageLimit[]; extraUsage: unknown }
  | { kind: 'error'; message: string }

export interface AppInfo {
  version: string
  dataDir: string
  /** OS login name, shown on the sidebar user card. */
  userName: string
}

/** API exposed to the renderer via contextBridge as window.pss */
export interface PssApi {
  getState(): Promise<AppState>
  createSession(type: SessionType, name?: string, cwd?: string): Promise<CreateSessionResult>
  closeSession(id: string): Promise<void>
  renameSession(id: string, name: string): Promise<void>
  duplicateSession(id: string): Promise<void>
  restartSession(id: string): Promise<void>
  reorderSessions(orderedIds: string[]): Promise<void>
  setActiveSession(id: string): Promise<void>
  reportCwd(id: string, cwd: string): void
  openAsPowershell(id: string): Promise<void>
  togglePin(id: string): Promise<void>
  createProject(input: CreateProjectInput): Promise<CreateSessionResult>
  addSessionToProject(projectId: string): Promise<CreateSessionResult>
  deleteProject(projectId: string): Promise<void>
  toggleProjectCollapsed(projectId: string): Promise<void>
  pickFolder(): Promise<string | null>
  getCliOptions(cli: CliKind): Promise<CliModelOption[]>
  openDataFolder(): Promise<void>
  getKimiUsage(): Promise<KimiUsageResult>
  getAppInfo(): Promise<AppInfo>
  /** Attach a terminal view to a PTY; resolves with buffered output so nothing is lost. */
  attachTerminal(id: string): Promise<string>
  ptyInput(id: string, data: string): void
  ptyResize(id: string, cols: number, rows: number): void
  openFolder(path: string): Promise<void>
  /** Open an http(s) URL in the system browser (never inside the app window). */
  openExternal(url: string): Promise<void>
  setSidebarWidth(width: number): void
  setTheme(theme: ThemeName): void
  focusWindow(): void
  onStateChanged(cb: (state: AppState) => void): () => void
  onPtyData(cb: (id: string, data: string) => void): () => void
  createChat(input: CreateChatInput): Promise<ChatMeta>
  sendChat(chatId: string, text: string, attachments?: ChatAttachment[]): Promise<SendChatResult>
  cancelChat(chatId: string): Promise<void>
  getChatHistory(chatId: string): Promise<ChatMessage[]>
  renameChat(chatId: string, title: string): Promise<void>
  deleteChat(chatId: string): Promise<void>
  setChatModel(chatId: string, model: string | undefined): Promise<void>
  setChatEffort(chatId: string, effort: string | undefined): Promise<void>
  togglePinChat(chatId: string): Promise<void>
  /** Open a terminal session running `kimi -r <kimiSessionId>` for this chat. */
  openChatInTerminal(chatId: string): Promise<CreateSessionResult>
  /** Multi-select file dialog (images / pdf / any); resolves with absolute paths. */
  pickFiles(): Promise<string[]>
  /** Persist pasted bytes under <dataDir>/attachments/ and describe them. */
  saveAttachment(name: string, data: Uint8Array): Promise<ChatAttachment>
  /** Wrap an existing absolute path as an attachment (no copy). */
  attachmentForPath(path: string): Promise<ChatAttachment>
  /** Build a renderer-loadable URL for an attachment path (custom protocol). */
  attachmentUrl(path: string): string
  /** Absolute path of a dropped File object (preload webUtils, no IPC). */
  pathForFile(file: File): string
  onChatEvent(cb: (chatId: string, event: ChatEvent) => void): () => void
}
