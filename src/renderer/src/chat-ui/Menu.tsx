import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export interface ChatMenuItem {
  label: string
  danger?: boolean
  disabled?: boolean
  onClick?(): void
}

/** Small popover menu; closes on outside click or Esc. Position comes from
    the CSS class (absolute inside a relative parent, or .up for popovers). */
export function ChatMenu({
  items,
  onClose,
  className,
  footer
}: {
  items: ChatMenuItem[]
  onClose(): void
  className?: string
  footer?: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <>
      <div className="popover-overlay" onClick={onClose} />
      <div className={`chat-menu${className ? ` ${className}` : ''}`}>
        {items.map((it) => (
          <button
            key={it.label}
            className={it.danger ? 'danger' : ''}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onClick?.()
            }}
          >
            {it.label}
          </button>
        ))}
        {footer}
      </div>
    </>
  )
}

/** Inline rename input: commits on Enter/blur, cancels on Esc (once only). */
export function RenameInput({
  initial,
  onCommit,
  onCancel
}: {
  initial: string
  onCommit(value: string): void
  onCancel(): void
}) {
  const doneRef = useRef(false)
  const commit = (v: string) => {
    if (doneRef.current) return
    doneRef.current = true
    onCommit(v)
  }
  const cancel = () => {
    if (doneRef.current) return
    doneRef.current = true
    onCancel()
  }
  return (
    <input
      className="rename-input"
      autoFocus
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(e.currentTarget.value)
        if (e.key === 'Escape') cancel()
      }}
      onBlur={(e) => commit(e.target.value)}
    />
  )
}
