import { execFile, spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type {
  ChatAttachment,
  ChatEvent,
  ChatMessage,
  ChatMeta,
  SendChatResult
} from '../../shared/types/chat'
import type { Logger } from '../logger'

type EventSink = (chatId: string, ev: ChatEvent) => void
type KimiSessionSink = (chatId: string, kimiSessionId: string) => void

interface QueuedTurn {
  text: string
  chat: ChatMeta
  attachments?: ChatAttachment[]
}

/** Live per-chat runtime: transcript cache, running process, FIFO queue. */
interface ChatRuntime {
  transcript: ChatMessage[] | null
  running: ChildProcess | null
  queue: QueuedTurn[]
  kimiSessionId?: string
  stderrTail: string
  sawEvent: boolean
  onEvent: EventSink | null
  onKimiSession: KimiSessionSink | null
}

function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('where.exe', [command], { timeout: 5000 }, (err) => resolve(!err))
  })
}

/**
 * Prefer the native launcher (<kimiHome>/bin/kimi.exe) over the npm shim:
 * going through `cmd.exe /c` mangles multi-line arguments (cmd splits on
 * newlines), which silently truncates prompts at the first line break.
 */
function resolveKimiExe(): string | null {
  const home = process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code')
  const exe = join(home, 'bin', 'kimi.exe')
  return existsSync(exe) ? exe : null
}

/**
 * Owns headless kimi processes, one turn at a time per chat.
 * Each turn is `kimi -p <text> --output-format stream-json` (+ `--session`
 * for follow-ups, `-m` for a pinned model); stdout is parsed as JSONL and
 * streamed to the renderer as ChatEvents. Transcripts persist as JSONL in
 * <dataDir>/chats/<chatId>.jsonl and are rewritten whole on each mutation
 * (files are small). Never throws — failures surface as error events.
 */
export class ChatRunner {
  private readonly runtimes = new Map<string, ChatRuntime>()
  private kimiAvailable: boolean | null = null
  private readonly kimiExe = resolveKimiExe()

  constructor(
    private readonly dataDir: string,
    private readonly logger: Logger
  ) {
    mkdirSync(this.chatsDir(), { recursive: true })
    if (this.kimiExe) this.logger.log('Chat Launcher', this.kimiExe)
  }

  async send(
    chat: ChatMeta,
    text: string,
    onEvent: EventSink,
    onKimiSession: KimiSessionSink,
    attachments?: ChatAttachment[]
  ): Promise<SendChatResult> {
    if (this.kimiAvailable === null) {
      this.kimiAvailable = this.kimiExe !== null || (await commandExists('kimi'))
      if (!this.kimiAvailable) this.logger.log('Chat CLI Missing', 'kimi not in PATH')
    }
    if (!this.kimiAvailable) {
      return { ok: false, error: 'Kimi CLI not found: "kimi" is not in PATH.' }
    }
    const rt = this.runtime(chat.id)
    rt.onEvent = onEvent
    rt.onKimiSession = onKimiSession
    rt.queue.push({ text, chat: { ...chat }, attachments })
    if (!rt.running) this.runNext(chat.id)
    return { ok: true }
  }

  cancel(chatId: string): void {
    const proc = this.runtimes.get(chatId)?.running
    if (!proc || proc.pid === undefined) return
    this.logger.log('Chat Cancel', chatId)
    // The npm kimi is a .cmd shim under cmd.exe; kill the whole tree so the
    // node process goes too. turn-done still fires from the close handler.
    execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], () => {
      try {
        proc.kill()
      } catch {
        // already dead
      }
    })
  }

  history(chatId: string): ChatMessage[] {
    return this.runtime(chatId).transcript ?? []
  }

  /** Drop transcript cache + file when the chat itself is deleted. */
  deleteTranscript(chatId: string): void {
    this.cancel(chatId)
    this.runtimes.delete(chatId)
    try {
      const file = this.transcriptFile(chatId)
      if (existsSync(file)) unlinkSync(file)
    } catch (err) {
      this.logger.error(`Chat Transcript Delete ${chatId}`, err)
    }
  }

  /** Kill every running turn (app shutdown). */
  killAll(): void {
    for (const id of [...this.runtimes.keys()]) this.cancel(id)
  }

  // ---------- internals ----------

  private chatsDir(): string {
    return join(this.dataDir, 'chats')
  }

  private transcriptFile(chatId: string): string {
    return join(this.chatsDir(), `${chatId}.jsonl`)
  }

  private runtime(chatId: string): ChatRuntime {
    let rt = this.runtimes.get(chatId)
    if (!rt) {
      rt = {
        transcript: null,
        running: null,
        queue: [],
        stderrTail: '',
        sawEvent: false,
        onEvent: null,
        onKimiSession: null
      }
      this.runtimes.set(chatId, rt)
    }
    if (rt.transcript === null) rt.transcript = this.loadTranscript(chatId)
    return rt
  }

  private loadTranscript(chatId: string): ChatMessage[] {
    const out: ChatMessage[] = []
    try {
      const file = this.transcriptFile(chatId)
      if (!existsSync(file)) return out
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as ChatMessage
          if (msg && typeof msg === 'object' && 'role' in msg) out.push(msg)
        } catch {
          // skip corrupt lines
        }
      }
    } catch (err) {
      this.logger.error(`Chat Transcript Load ${chatId}`, err)
    }
    return out
  }

  private persistTranscript(chatId: string): void {
    const rt = this.runtimes.get(chatId)
    if (!rt?.transcript) return
    try {
      writeFileSync(
        this.transcriptFile(chatId),
        rt.transcript.map((m) => JSON.stringify(m)).join('\n') + '\n',
        'utf8'
      )
    } catch (err) {
      this.logger.error(`Chat Transcript Save ${chatId}`, err)
    }
  }

  private appendMessage(chatId: string, msg: ChatMessage): void {
    this.runtime(chatId).transcript!.push(msg)
    this.persistTranscript(chatId)
  }

  private runNext(chatId: string): void {
    const rt = this.runtimes.get(chatId)
    if (!rt || rt.running) return
    const turn = rt.queue.shift()
    if (!turn) return
    const { chat, text, attachments } = turn
    // Record the user message only when its turn actually starts, so the
    // transcript stays interleaved even when turns queue behind a running one.
    const userMsg: Extract<ChatMessage, { role: 'user' }> = {
      role: 'user',
      content: text,
      ts: Date.now()
    }
    if (attachments && attachments.length > 0) userMsg.attachments = attachments
    this.appendMessage(chatId, userMsg)
    // The model reads attachments via its own tools; point it at the paths.
    let prompt = text
    if (attachments && attachments.length > 0) {
      const lines = attachments.map((a) =>
        a.kind === 'image'
          ? `- 图片: ${a.path}（用 ReadMediaFile 工具查看这张图片）`
          : `- 文件: ${a.path}`
      )
      prompt = `${text}\n\n[用户附件]\n${lines.join('\n')}`
    }
    const kimiSessionId = rt.kimiSessionId ?? chat.kimiSessionId
    const args = ['-p', prompt, '--output-format', 'stream-json']
    if (kimiSessionId) args.push('--session', kimiSessionId)
    if (chat.model) args.push('-m', chat.model)
    // cwd may have been deleted between runs; fall back so the turn still runs.
    const cwd = existsSync(chat.cwd) ? chat.cwd : homedir()
    rt.stderrTail = ''
    rt.sawEvent = false
    let proc: ChildProcess
    try {
      // Thinking effort is forced via env (kimi provider reads it on the wire).
      const env = chat.effort
        ? { ...process.env, KIMI_MODEL_THINKING_EFFORT: chat.effort }
        : undefined
      if (this.kimiExe) {
        proc = spawn(this.kimiExe, args, { cwd, env })
      } else {
        // Fallback: npm shim must go through cmd.exe, which mangles multi-line
        // args (cmd splits on newlines) — flatten the prompt to stay safe.
        const flat = prompt.replace(/\r?\n+/g, ' ')
        const flatArgs = ['-p', flat, ...args.slice(2)]
        this.logger.log('Chat Launcher Fallback', 'cmd.exe shim, newlines flattened')
        proc = spawn('cmd.exe', ['/c', 'kimi', ...flatArgs], { cwd, env })
      }
    } catch (err) {
      this.logger.error(`Chat Spawn ${chatId}`, err)
      this.emit(chatId, { kind: 'error', message: err instanceof Error ? err.message : String(err) })
      this.runNext(chatId)
      return
    }
    rt.running = proc
    this.logger.log('Chat Turn Start', `${chatId} session=${kimiSessionId ?? 'new'} @ ${cwd}`)

    let buf = ''
    proc.stdout?.on('data', (data: Buffer) => {
      buf += data.toString('utf8')
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        this.handleLine(chatId, line)
      }
    })
    proc.stderr?.on('data', (data: Buffer) => {
      // Tool progress/diagnostics — ignored except for logging/error tail.
      rt.stderrTail = (rt.stderrTail + data.toString('utf8')).slice(-4000)
    })
    proc.on('error', (err) => {
      this.logger.error(`Chat Process ${chatId}`, err)
    })
    proc.on('close', (code) => {
      if (buf.trim()) this.handleLine(chatId, buf)
      rt.running = null
      this.logger.log('Chat Turn Done', `${chatId} code=${code ?? 'null'}`)
      if (code !== 0 && !rt.sawEvent) {
        const tail = rt.stderrTail.trim().split(/\r?\n/).slice(-3).join(' ')
        this.emit(chatId, {
          kind: 'error',
          message: tail || `kimi exited with code ${code ?? 'unknown'}`
        })
      } else {
        this.emit(chatId, { kind: 'turn-done', kimiSessionId: rt.kimiSessionId })
      }
      this.runNext(chatId)
    })
  }

  private handleLine(chatId: string, line: string): void {
    if (!line.trim()) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string' && msg.content) {
        this.emit(chatId, { kind: 'assistant-text', text: msg.content })
        this.appendMessage(chatId, { role: 'assistant', content: msg.content, ts: Date.now() })
      }
      if (Array.isArray(msg.tool_calls)) {
        for (const call of msg.tool_calls) {
          const c = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
          const callId = typeof c?.id === 'string' ? c.id : ''
          if (!callId) continue
          const name = typeof c?.function?.name === 'string' ? c.function.name : ''
          const args =
            typeof c?.function?.arguments === 'string'
              ? c.function.arguments
              : JSON.stringify(c?.function?.arguments ?? '')
          this.emit(chatId, { kind: 'tool-call', callId, name, arguments: args })
          this.appendMessage(chatId, { role: 'tool', callId, name, arguments: args, ts: Date.now() })
        }
      }
      return
    }
    if (msg.role === 'tool' && typeof msg.tool_call_id === 'string') {
      const callId = msg.tool_call_id
      const result =
        typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '')
      this.emit(chatId, { kind: 'tool-result', callId, result })
      // Fill in the result on the matching tool message (search from the end).
      const transcript = this.runtimes.get(chatId)?.transcript ?? []
      for (let i = transcript.length - 1; i >= 0; i--) {
        const m = transcript[i]
        if (m.role === 'tool' && m.callId === callId) {
          m.result = result
          this.persistTranscript(chatId)
          break
        }
      }
      return
    }
    if (msg.role === 'meta' && msg.type === 'session.resume_hint') {
      if (typeof msg.session_id === 'string' && msg.session_id) {
        const rt = this.runtimes.get(chatId)
        if (rt) rt.kimiSessionId = msg.session_id
        rt?.onKimiSession?.(chatId, msg.session_id)
      }
    }
  }

  private emit(chatId: string, ev: ChatEvent): void {
    const rt = this.runtimes.get(chatId)
    if (!rt) return
    rt.sawEvent = true
    rt.onEvent?.(chatId, ev)
  }
}
