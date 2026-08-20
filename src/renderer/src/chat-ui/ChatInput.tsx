import { useEffect, useRef, useState } from 'react'
import type { ClipboardEvent, DragEvent } from 'react'
import { api } from '../api'
import { useChatStore } from './store'
import { ModelEffortChip } from './ModelEffortChip'
import type { ChatAttachment } from '../../../shared/types/chat'

interface ChatInputProps {
  /** null on the home page: first send creates the chat. */
  chatId: string | null
  placeholder?: string
  /** Controlled draft (home page quick actions fill the input). */
  value?: string
  onChange?: (text: string) => void
}

export function ChatInput({ chatId, placeholder, value, onChange }: ChatInputProps) {
  const streaming = useChatStore((s) => (chatId ? !!s.streaming[chatId] : false))
  const chats = useChatStore((s) => s.chats)
  const homeProjectId = useChatStore((s) => s.homeProjectId)
  const homeCwd = useChatStore((s) => s.homeCwd)
  const homeModel = useChatStore((s) => s.homeModel)
  const homeEffort = useChatStore((s) => s.homeEffort)
  const setHomeModel = useChatStore((s) => s.setHomeModel)
  const setHomeEffort = useChatStore((s) => s.setHomeEffort)
  const send = useChatStore((s) => s.send)
  const queueMessage = useChatStore((s) => s.queueMessage)

  const [inner, setInner] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const text = value ?? inner
  const setText = onChange ?? setInner
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined
  const model = chatId ? chat?.model : homeModel
  const effort = chatId ? chat?.effort : homeEffort

  // Focus the composer when the view mounts or the active chat changes.
  useEffect(() => {
    areaRef.current?.focus()
  }, [chatId])

  // Auto-grow the textarea up to a cap.
  useEffect(() => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 336)}px`
  }, [text])

  const addAttachments = (list: ChatAttachment[]) => {
    if (list.length) setAttachments((prev) => [...prev, ...list])
  }

  // ＋ button: native multi-select file dialog.
  const pickFiles = async () => {
    const paths = await api.pickFiles()
    const items = await Promise.all(paths.map((p) => api.attachmentForPath(p)))
    addAttachments(items)
  }

  // Clipboard image paste: persist the bytes, then chip them.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files)
    if (!files.length) return
    e.preventDefault()
    void Promise.all(
      files.map(async (f) => {
        const bytes = new Uint8Array(await f.arrayBuffer())
        return api.saveAttachment(f.name || 'pasted.png', bytes)
      })
    ).then(addAttachments)
  }

  // Drag & drop: resolve absolute paths via preload webUtils; skip failures.
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    void Promise.all(
      files.map(async (f) => {
        const path = api.pathForFile(f)
        return path ? api.attachmentForPath(path) : null
      })
    ).then((items) => addAttachments(items.filter((a): a is ChatAttachment => !!a)))
  }

  const doSend = () => {
    if (!text.trim() && attachments.length === 0) return
    // A turn is already running: queue the message; it auto-sends on turn-done
    // (stopping the turn flushes the queue too — that's the steer path).
    if (streaming && chatId) {
      queueMessage(
        chatId,
        text.trim() || '请查看附件',
        attachments.length ? attachments : undefined
      )
      setText('')
      setAttachments([])
      return
    }
    void send(
      chatId,
      text,
      {
        projectId: chatId ? undefined : homeProjectId ?? undefined,
        cwd: chatId ? undefined : homeCwd ?? undefined
      },
      attachments.length ? attachments : undefined
    )
    setText('')
    setAttachments([])
  }

  const canSend = !!text.trim() || attachments.length > 0

  return (
    <div
      className={`chat-input-box${dragOver ? ' drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      {attachments.length > 0 && (
        <div className="chat-attach-chips">
          {attachments.map((a, i) => (
            <span key={`${a.path}-${i}`} className="chat-attach-chip" title={a.path}>
              {a.kind === 'image' ? (
                <img className="chat-attach-thumb" src={api.attachmentUrl(a.path)} alt={a.name} />
              ) : (
                <span className="chat-attach-icon">📄</span>
              )}
              <span className="chat-attach-name">{a.name}</span>
              <button
                className="chat-chip-clear"
                title="移除附件"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={areaRef}
        className="chat-input"
        rows={1}
        placeholder={placeholder ?? '随心输入'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            doSend()
          }
        }}
      />

      <div className="chat-input-row">
        <button className="chat-plus-btn" title="添加附件" onClick={() => void pickFiles()}>
          ＋
        </button>
        <span className="chat-chip readonly">🛡 完全访问</span>
        <span className="chat-input-spacer" />
        <ModelEffortChip
          model={model}
          effort={effort}
          onModelChange={(m) => (chatId ? void api.setChatModel(chatId, m) : setHomeModel(m))}
          onEffortChange={(e) => (chatId ? void api.setChatEffort(chatId, e) : setHomeEffort(e))}
        />
        {streaming && chatId && (
          <button
            className="chat-send-btn stop"
            title="停止生成（排队中的消息会接着发送）"
            onClick={() => void api.cancelChat(chatId)}
          >
            ■
          </button>
        )}
        <button
          className="chat-send-btn"
          title={streaming && chatId ? '排队发送' : '发送'}
          disabled={!canSend}
          onClick={doSend}
        >
          ↑
        </button>
      </div>
    </div>
  )
}
