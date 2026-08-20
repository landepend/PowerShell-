import { useMemo } from 'react'
import type { MouseEvent } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { api } from '../api'

marked.setOptions({ breaks: true, gfm: true })

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Fenced code blocks get a header bar (language label + copy button). The
// button is wired by click delegation in the component below.
const renderer = new marked.Renderer()
renderer.code = ({ text, lang }) => {
  const label = lang ? escapeHtml(lang) : 'code'
  return (
    `<div class="chat-md-codeblock"><div class="chat-md-codehead">` +
    `<span class="chat-md-lang">${label}</span>` +
    `<button type="button" class="chat-md-copy">复制</button></div>` +
    `<pre><code>${escapeHtml(text)}</code></pre></div>`
  )
}

/** Assistant messages are Markdown; sanitize before injecting HTML. Links must
    never navigate the app window — they go to the system browser instead. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, renderer })),
    [text]
  )
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    const copyBtn = el.closest('.chat-md-copy')
    if (copyBtn) {
      const code = copyBtn.closest('.chat-md-codeblock')?.querySelector('pre code')?.textContent
      if (code) {
        void navigator.clipboard.writeText(code)
        copyBtn.textContent = '已复制'
        setTimeout(() => {
          copyBtn.textContent = '复制'
        }, 1200)
      }
      return
    }
    const anchor = el.closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    e.preventDefault()
    void api.openExternal(href)
  }
  // eslint-disable-next-line react/no-danger
  return <div className="chat-md" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
