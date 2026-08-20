import { homedir } from 'os'
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatMeta,
  CreateChatInput,
  SendChatResult
} from '../../shared/types/chat'
import type { CreateSessionResult } from '../../shared/types/api'
import type { Logger } from '../logger'
import type { WorkspaceManager } from '../workspace/WorkspaceManager'
import type { SessionManager } from '../terminal/SessionManager'
import type { PtyManager } from '../terminal/PtyManager'
import type { ChatRunner } from './ChatRunner'

interface Deps {
  workspace: WorkspaceManager
  sessions: SessionManager
  pty: PtyManager
  runner: ChatRunner
  logger: Logger
  /** Forward a streaming event to the renderer (index.ts owns the window). */
  forwardEvent: (chatId: string, ev: ChatEvent) => void
}

const DEFAULT_TITLE = '新对话'
const AUTO_TITLE_LEN = 30
// Default launch config for new chats; change here to switch defaults.
const DEFAULT_CHAT_MODEL = 'kimi-code/k3-256k'
const DEFAULT_CHAT_EFFORT = 'max'

/**
 * Single source of truth for chats. Owns the ChatMeta list in workspace.json
 * (create / rename / delete / setModel / touch) and hands turn execution to
 * ChatRunner. State notifications go through the same callback shape as
 * SessionManager — the caller re-pushes the full AppState.
 */
export class ChatManager {
  constructor(
    private readonly deps: Deps,
    private readonly onChatsChanged: () => void
  ) {
    // Self-heal: a chat bound to a project must run in the project's folder
    // (repairs chats created before create() enforced this).
    let repaired = 0
    for (const chat of this.deps.workspace.state.chats) {
      const project = chat.projectId
        ? this.deps.workspace.state.projects.find((p) => p.id === chat.projectId)
        : undefined
      if (project && chat.cwd !== project.cwd) {
        chat.cwd = project.cwd
        repaired++
      }
    }
    if (repaired > 0) {
      this.deps.workspace.scheduleSave()
      this.deps.logger.log('Chat Cwd Repair', `${repaired} chats realigned to project cwd`)
    }
  }

  list(): ChatMeta[] {
    return this.deps.workspace.state.chats.map((c) => ({ ...c }))
  }

  create(input: CreateChatInput): ChatMeta {
    const now = new Date().toISOString()
    // A project binding owns the working directory — never trust a
    // caller-supplied cwd when a project is given (and drop dangling ids).
    const project = input.projectId
      ? this.deps.workspace.state.projects.find((p) => p.id === input.projectId)
      : undefined
    const chat: ChatMeta = {
      id: this.nextId(),
      title: DEFAULT_TITLE,
      cwd: project?.cwd ?? (input.cwd?.trim() || homedir()),
      projectId: project?.id,
      model: DEFAULT_CHAT_MODEL,
      effort: DEFAULT_CHAT_EFFORT,
      createdAt: now,
      lastActiveAt: now
    }
    this.deps.workspace.update((d) => {
      d.chats.push(chat)
    })
    this.deps.logger.log('Chat Created', `${chat.id} @ ${chat.cwd}`)
    this.onChatsChanged()
    return { ...chat }
  }

  async send(
    chatId: string,
    text: string,
    attachments?: ChatAttachment[]
  ): Promise<SendChatResult> {
    const chat = this.find(chatId)
    if (!chat) return { ok: false, error: '对话不存在' }
    if (!text.trim() && !attachments?.length) return { ok: false, error: '消息为空' }
    chat.lastActiveAt = new Date().toISOString()
    // Auto-title from the first user message while the title is untouched.
    if (chat.title === DEFAULT_TITLE) {
      const firstLine = text.trim().split(/\r?\n/)[0]
      chat.title = firstLine.slice(0, AUTO_TITLE_LEN) || DEFAULT_TITLE
    }
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
    return this.deps.runner.send(
      { ...chat },
      text,
      this.deps.forwardEvent,
      (id, kimiSessionId) => this.onKimiSession(id, kimiSessionId),
      attachments
    )
  }

  cancel(chatId: string): void {
    this.deps.runner.cancel(chatId)
  }

  history(chatId: string): ChatMessage[] {
    return this.deps.runner.history(chatId)
  }

  rename(chatId: string, title: string): void {
    const chat = this.find(chatId)
    const trimmed = title.trim()
    if (!chat || !trimmed || chat.title === trimmed) return
    chat.title = trimmed
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
  }

  delete(chatId: string): void {
    if (!this.find(chatId)) return
    this.deps.runner.deleteTranscript(chatId)
    this.deps.workspace.update((d) => {
      d.chats = d.chats.filter((c) => c.id !== chatId)
    })
    this.deps.logger.log('Chat Deleted', chatId)
    this.onChatsChanged()
  }

  setModel(chatId: string, model: string | undefined): void {
    const chat = this.find(chatId)
    if (!chat) return
    const next = model?.trim() || undefined
    if (chat.model === next) return
    chat.model = next
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
  }

  setEffort(chatId: string, effort: string | undefined): void {
    const chat = this.find(chatId)
    if (!chat) return
    const next = effort?.trim() || undefined
    if (chat.effort === next) return
    chat.effort = next
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
  }

  togglePin(chatId: string): void {
    const chat = this.find(chatId)
    if (!chat) return
    chat.pinned = !chat.pinned || undefined
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
  }

  /** Open the conversation in a real terminal: new PowerShell session + `kimi -r`. */
  async openInTerminal(chatId: string): Promise<CreateSessionResult> {
    const chat = this.find(chatId)
    if (!chat) return { ok: false, error: '对话不存在' }
    const result = await this.deps.sessions.create('powershell', chat.title, chat.cwd)
    if (result.ok && result.session) {
      const sessionId = result.session.id
      const command = chat.kimiSessionId ? `kimi -r ${chat.kimiSessionId}` : 'kimi'
      // Give the shell a moment to reach its prompt before typing the command.
      setTimeout(() => this.deps.pty.write(sessionId, `${command}\r`), 800)
    }
    return result
  }

  // ---------- internals ----------

  /** Persist the kimi session id captured from the stream-json resume hint. */
  private onKimiSession(chatId: string, kimiSessionId: string): void {
    const chat = this.find(chatId)
    if (!chat || chat.kimiSessionId === kimiSessionId) return
    chat.kimiSessionId = kimiSessionId
    this.deps.workspace.scheduleSave()
    this.onChatsChanged()
  }

  private find(chatId: string): ChatMeta | undefined {
    return this.deps.workspace.state.chats.find((c) => c.id === chatId)
  }

  private nextId(): string {
    let max = 0
    for (const c of this.deps.workspace.state.chats) {
      const m = /^chat_(\d+)$/.exec(c.id)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `chat_${String(max + 1).padStart(3, '0')}`
  }
}
