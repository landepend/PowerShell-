import { create } from 'zustand'
import { api } from '../api'
import { useSessionStore } from '../stores/sessionStore'
import type { ChatAttachment, ChatEvent, ChatMessage, ChatMeta } from '../../../shared/types/chat'
import type { ProjectMeta } from '../../../shared/types/session'

export type ChatUiView = { kind: 'home' } | { kind: 'chat'; chatId: string } | { kind: 'terminal' }

/** Sections of the chat-ui settings page. */
export type ChatSettingsSection = 'general' | 'appearance' | 'usage' | 'about'

/** Defaults mirrored from the backend for chats created from the home page. */
export const DEFAULT_HOME_MODEL = 'kimi-code/k3-256k'
export const DEFAULT_HOME_EFFORT = 'max'

interface SendOptions {
  projectId?: string
  /** Explicit cwd from "选择文件夹…"; only used when no projectId. */
  cwd?: string
}

/** Target picked on the home page: an existing project or a loose folder. */
interface HomeTarget {
  projectId?: string
  cwd?: string
}

/** A message queued while a turn is streaming; sent when the turn ends. */
interface QueuedMessage {
  content: string
  attachments?: ChatAttachment[]
}

interface ChatUiStore {
  view: ChatUiView
  chats: ChatMeta[]
  projects: ProjectMeta[]
  messages: Record<string, ChatMessage[]>
  streaming: Record<string, boolean>
  /** Chat ids whose history has been fetched (lazy, once per session). */
  loaded: Record<string, boolean>
  /** Project preselected for the next home-page send (sidebar chip). */
  homeProjectId: string | null
  /** Loose folder picked on the home page (cleared when a project is picked). */
  homeCwd: string | null
  /** Model/effort applied to chats created from the home page. */
  homeModel: string | undefined
  homeEffort: string | undefined
  /** Section the chat-ui settings page opens on. */
  settingsSection: ChatSettingsSection
  /** Per-chat outbox: messages typed while a turn is streaming. */
  queue: Record<string, QueuedMessage[]>

  syncState(chats: ChatMeta[], projects: ProjectMeta[]): void
  openHome(projectId?: string): void
  openChat(chatId: string): void
  openTerminal(): void
  openSettings(section?: ChatSettingsSection): void
  setHomeTarget(target: HomeTarget | null): void
  setHomeModel(model: string | undefined): void
  setHomeEffort(effort: string | undefined): void
  queueMessage(chatId: string, content: string, attachments?: ChatAttachment[]): void
  removeQueued(chatId: string, index: number): void
  send(
    chatId: string | null,
    text: string,
    opts?: SendOptions,
    attachments?: ChatAttachment[]
  ): Promise<void>
  handleEvent(chatId: string, event: ChatEvent): void
}

export const useChatStore = create<ChatUiStore>()((set, get) => ({
  view: { kind: 'home' },
  chats: [],
  projects: [],
  messages: {},
  streaming: {},
  loaded: {},
  homeProjectId: null,
  homeCwd: null,
  homeModel: DEFAULT_HOME_MODEL,
  homeEffort: DEFAULT_HOME_EFFORT,
  settingsSection: 'general',
  queue: {},

  syncState: (chats, projects) => set({ chats, projects }),

  openHome: (projectId) =>
    set({ view: { kind: 'home' }, homeProjectId: projectId ?? null, homeCwd: null }),

  setHomeTarget: (target) =>
    set({ homeProjectId: target?.projectId ?? null, homeCwd: target?.cwd ?? null }),

  setHomeModel: (model) => set({ homeModel: model }),
  setHomeEffort: (effort) => set({ homeEffort: effort }),

  queueMessage: (chatId, content, attachments) =>
    set((prev) => ({
      queue: {
        ...prev.queue,
        [chatId]: [
          ...(prev.queue[chatId] ?? []),
          { content, ...(attachments?.length ? { attachments } : {}) }
        ]
      }
    })),

  removeQueued: (chatId, index) =>
    set((prev) => {
      const list = [...(prev.queue[chatId] ?? [])]
      list.splice(index, 1)
      return { queue: { ...prev.queue, [chatId]: list } }
    }),

  openChat: (chatId) => {
    set({ view: { kind: 'chat', chatId } })
    if (get().loaded[chatId]) return
    set((prev) => ({ loaded: { ...prev.loaded, [chatId]: true } }))
    void api.getChatHistory(chatId).then((history) => {
      set((prev) => ({ messages: { ...prev.messages, [chatId]: history } }))
    })
  },

  openTerminal: () => set({ view: { kind: 'terminal' } }),

  openSettings: (section) => {
    if (section) set({ settingsSection: section })
    useSessionStore.getState().setSettingsOpen(true)
  },

  send: async (chatId, text, opts, attachments) => {
    const trimmed = text.trim()
    if (!trimmed && !attachments?.length) return
    const content = trimmed || '请查看附件'
    let id = chatId
    if (!id) {
      // Home page: create the chat first, then jump into it.
      const meta = await api.createChat({ cwd: opts?.cwd, projectId: opts?.projectId })
      id = meta.id
      // Apply the home-page model/effort picks (backend also defaults these).
      const { homeModel, homeEffort } = get()
      if (homeModel) void api.setChatModel(id, homeModel)
      if (homeEffort) void api.setChatEffort(id, homeEffort)
      set((prev) => ({
        view: { kind: 'chat', chatId: id! },
        loaded: { ...prev.loaded, [id!]: true },
        messages: { ...prev.messages, [id!]: [] }
      }))
    }
    const target = id
    set((prev) => ({
      messages: {
        ...prev.messages,
        [target]: [
          ...(prev.messages[target] ?? []),
          {
            role: 'user',
            content,
            ...(attachments?.length ? { attachments } : {}),
            ts: Date.now()
          }
        ]
      },
      streaming: { ...prev.streaming, [target]: true }
    }))
    const res = await api.sendChat(target, content, attachments)
    if (!res.ok) {
      get().handleEvent(target, { kind: 'error', message: res.error ?? '发送失败' })
    }
  },

  handleEvent: (chatId, event) => {
    set((prev) => {
      const list = prev.messages[chatId] ?? []
      switch (event.kind) {
        case 'assistant-text':
          return {
            messages: {
              ...prev.messages,
              [chatId]: [...list, { role: 'assistant', content: event.text, ts: Date.now() }]
            }
          }
        case 'tool-call':
          return {
            messages: {
              ...prev.messages,
              [chatId]: [
                ...list,
                {
                  role: 'tool',
                  callId: event.callId,
                  name: event.name,
                  arguments: event.arguments,
                  ts: Date.now()
                }
              ]
            }
          }
        case 'tool-result':
          return {
            messages: {
              ...prev.messages,
              [chatId]: list.map((m) =>
                m.role === 'tool' && m.callId === event.callId ? { ...m, result: event.result } : m
              )
            }
          }
        case 'turn-done':
          return { streaming: { ...prev.streaming, [chatId]: false } }
        case 'error':
          return {
            messages: {
              ...prev.messages,
              [chatId]: [
                ...list,
                { role: 'assistant', content: `错误：${event.message}`, ts: Date.now() }
              ]
            },
            streaming: { ...prev.streaming, [chatId]: false }
          }
      }
    })
    // Turn ended (or failed, or was cancelled): send the next queued message.
    // This is also what makes "stop → steer" work — cancel fires turn-done.
    if (event.kind === 'turn-done' || event.kind === 'error') {
      const [next, ...rest] = get().queue[chatId] ?? []
      if (next) {
        set((prev) => ({ queue: { ...prev.queue, [chatId]: rest } }))
        void get().send(chatId, next.content, undefined, next.attachments)
      }
    }
  }
}))

/** Wire the store to the backend: state snapshots + streaming chat events. */
export function initChatUi(): () => void {
  void api.getState().then((state) => {
    useChatStore.getState().syncState(state.chats, state.projects)
  })
  const offState = api.onStateChanged((state) => {
    useChatStore.getState().syncState(state.chats, state.projects)
  })
  const offChat = api.onChatEvent((chatId, event) => {
    useChatStore.getState().handleEvent(chatId, event)
  })
  return () => {
    offState()
    offChat()
  }
}
