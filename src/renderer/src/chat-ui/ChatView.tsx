import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useChatStore } from './store'
import { ChatInput } from './ChatInput'
import { ToolCallBlock } from './ToolCallBlock'
import { ModelEffortChip } from './ModelEffortChip'
import { ProjectBar } from './ProjectBar'
import { ChatMenu, RenameInput } from './Menu'
import { Markdown } from './Markdown'
import type { ChatAttachment, ChatMessage } from '../../../shared/types/chat'

/** Stable empty list: zustand v5 selectors must return cached references,
    `s.messages[chatId] ?? []` inline would loop the renderer into a crash. */
const NO_MESSAGES: ChatMessage[] = []
const NO_QUEUE: { content: string; attachments?: ChatAttachment[] }[] = []

/** Attachment row above a user message: images as thumbnails, files as chips. */
function AttachmentList({
  attachments,
  onImageClick
}: {
  attachments: ChatAttachment[]
  onImageClick(path: string): void
}) {
  return (
    <div className="chat-msg-attachments">
      {attachments.map((a, i) =>
        a.kind === 'image' ? (
          <img
            key={`${a.path}-${i}`}
            className="chat-msg-image"
            src={api.attachmentUrl(a.path)}
            alt={a.name}
            title={a.name}
            onClick={() => onImageClick(a.path)}
          />
        ) : (
          <button
            key={`${a.path}-${i}`}
            className="chat-msg-file"
            title={a.path}
            onClick={() => void api.openFolder(a.path)}
          >
            📄 {a.name}
          </button>
        )
      )}
    </div>
  )
}

/** Round icon button copying message text, with transient ✓ feedback. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="chat-msg-action"
      title={copied ? '已复制' : '复制'}
      onClick={() => {
        void navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
    >
      {copied ? '✓' : '⧉'}
    </button>
  )
}

export function ChatView({ chatId }: { chatId: string }) {
  const chats = useChatStore((s) => s.chats)
  const messages = useChatStore((s) => s.messages[chatId] ?? NO_MESSAGES)
  const queued = useChatStore((s) => s.queue[chatId] ?? NO_QUEUE)
  const removeQueued = useChatStore((s) => s.removeQueued)
  const streaming = useChatStore((s) => !!s.streaming[chatId])
  const openHome = useChatStore((s) => s.openHome)
  const openTerminal = useChatStore((s) => s.openTerminal)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [showBackBottom, setShowBackBottom] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Auto-scroll only while the user is pinned to the bottom.
  const pinnedRef = useRef(true)

  const chat = chats.find((c) => c.id === chatId)

  // Switching chats re-pins the scroller to the bottom.
  useEffect(() => {
    pinnedRef.current = true
    setShowBackBottom(false)
  }, [chatId])

  // Lightbox closes on Esc as well as on click.
  useEffect(() => {
    if (!lightbox) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  // Keep the latest exchange in view when pinned.
  useEffect(() => {
    const el = listRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [messages, streaming])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    pinnedRef.current = near
    setShowBackBottom(!near)
  }

  const scrollToBottom = () => {
    const el = listRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  const openInTerminal = async () => {
    const res = await api.openChatInTerminal(chatId)
    if (res.ok) openTerminal()
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        {renaming && chat ? (
          <RenameInput
            initial={chat.title}
            onCommit={(title) => {
              setRenaming(false)
              const t = title.trim()
              if (t && t !== chat.title) void api.renameChat(chatId, t)
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span
            className="chat-header-title"
            title="点击重命名"
            onClick={() => chat && setRenaming(true)}
          >
            {chat?.title || '新对话'}
          </span>
        )}
        <span className="chat-input-spacer" />
        <ModelEffortChip
          model={chat?.model}
          effort={chat?.effort}
          onModelChange={(m) => void api.setChatModel(chatId, m)}
          onEffortChange={(e) => void api.setChatEffort(chatId, e)}
        />
        <button
          className="chat-ghost-btn"
          title="在终端会话中继续此对话"
          onClick={() => void openInTerminal()}
        >
          在终端中继续
        </button>
        <span className="chat-header-menu-wrap">
          <button className="chat-ghost-btn" title="更多" onClick={() => setMenuOpen(true)}>
            ···
          </button>
          {menuOpen && (
            <ChatMenu
              onClose={() => setMenuOpen(false)}
              items={[
                {
                  label: chat?.pinned ? '取消置顶' : '置顶',
                  onClick: () => void api.togglePinChat(chatId)
                },
                { label: '重命名', onClick: () => setRenaming(true) },
                {
                  label: '删除',
                  danger: true,
                  onClick: () => {
                    openHome()
                    void api.deleteChat(chatId)
                  }
                }
              ]}
            />
          )}
        </span>
      </div>

      <div className="chat-messages" ref={listRef} onScroll={onScroll}>
        <div className="chat-messages-inner">
          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="chat-msg-group user">
                <div className="chat-msg-user">
                  {m.attachments && m.attachments.length > 0 && (
                    <AttachmentList attachments={m.attachments} onImageClick={setLightbox} />
                  )}
                  {m.content}
                </div>
                <div className="chat-msg-actions">
                  <CopyButton text={m.content} />
                </div>
              </div>
            ) : m.role === 'assistant' ? (
              <div key={i} className="chat-msg-group">
                <div className="chat-msg-assistant">
                  <Markdown text={m.content} />
                  {streaming && i === messages.length - 1 && <span className="chat-caret" />}
                </div>
                <div className="chat-msg-actions">
                  <CopyButton text={m.content} />
                </div>
              </div>
            ) : (
              <ToolCallBlock key={i} name={m.name} arguments={m.arguments} result={m.result} />
            )
          )}
          {/* Shimmer only while waiting for the first token; once content or
              tool blocks flow, the transcript itself shows the progress. */}
          {streaming &&
            (messages.length === 0 || messages[messages.length - 1].role === 'user') && (
              <div className="chat-shimmer">正在思考…</div>
            )}
          {queued.map((qm, i) => (
            <div key={`queued-${i}`} className="chat-msg-group user">
              <div className="chat-msg-user queued">
                <span className="chat-queued-tag">排队中</span>
                {qm.attachments && qm.attachments.length > 0 && (
                  <span className="chat-queued-attach">📎 {qm.attachments.length} 个附件</span>
                )}
                {qm.content}
                <button
                  className="chat-chip-clear"
                  title="移出队列"
                  onClick={() => removeQueued(chatId, i)}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-view-input">
        {showBackBottom && (
          <button className="chat-back-bottom" title="回到底部" onClick={scrollToBottom}>
            ↓
          </button>
        )}
        <div className="chat-composer-col">
          <ProjectBar readOnly projectId={chat?.projectId} cwd={chat?.cwd} />
          <ChatInput chatId={chatId} />
        </div>
      </div>

      {lightbox && (
        <div className="chat-lightbox" onClick={() => setLightbox(null)}>
          <img src={api.attachmentUrl(lightbox)} alt="" />
        </div>
      )}
    </div>
  )
}
