/**
 * Chat domain types — part of the Layer 1 contract between the
 * PowerShell++ backend and the chat UI layer (src/renderer/src/chat-ui).
 */

/** Serializable chat metadata — lands in workspace.json under `chats`. */
export interface ChatMeta {
  id: string // chat_NNN
  /** Generated from the first user message; can be renamed. */
  title: string
  /** Working directory the headless CLI runs in; homedir when no project. */
  cwd: string
  /** Optional link to a ProjectMeta. */
  projectId?: string
  /** Kimi CLI session id captured from the stream-json resume hint. */
  kimiSessionId?: string
  /** Model alias passed to `kimi -m`; omitted = CLI default. */
  model?: string
  /** Thinking effort passed via KIMI_MODEL_THINKING_EFFORT, e.g. 'low'|'high'|'max'. */
  effort?: string
  /** Pinned chats show in the 置顶 section above everything else. */
  pinned?: boolean
  createdAt: string
  lastActiveAt: string
}

/** A file the user attached to a chat message (image paste, picked file, ...). */
export interface ChatAttachment {
  kind: 'image' | 'file'
  name: string
  /** Absolute path; pasted images live under <dataDir>/attachments/. */
  path: string
}

/** One transcript entry, persisted as a JSONL line in data/chats/<id>.jsonl. */
export type ChatMessage =
  | { role: 'user'; content: string; attachments?: ChatAttachment[]; ts: number }
  | { role: 'assistant'; content: string; ts: number }
  | {
      role: 'tool'
      callId: string
      name: string
      arguments: string
      result?: string
      ts: number
    }

/** Streaming event pushed from main to renderer while a turn runs. */
export type ChatEvent =
  | { kind: 'assistant-text'; text: string }
  | { kind: 'tool-call'; callId: string; name: string; arguments: string }
  | { kind: 'tool-result'; callId: string; result: string }
  | { kind: 'turn-done'; kimiSessionId?: string }
  | { kind: 'error'; message: string }

export interface CreateChatInput {
  /** Defaults to the user's home directory when omitted. */
  cwd?: string
  projectId?: string
}

export interface SendChatResult {
  ok: boolean
  error?: string
}
