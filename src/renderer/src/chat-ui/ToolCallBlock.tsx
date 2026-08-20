import { useState } from 'react'

interface ToolCallBlockProps {
  name: string
  arguments: string
  result?: string
}

/** Best-effort one-line summary of a tool call's arguments JSON. */
function summarize(args: string): string {
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    for (const key of ['path', 'file', 'filePath', 'command', 'cmd', 'pattern', 'query', 'url']) {
      const v = obj[key]
      if (typeof v === 'string' && v) {
        return v.length > 80 ? `${v.slice(0, 80)}…` : v
      }
    }
    const first = Object.values(obj).find((v) => typeof v === 'string') as string | undefined
    if (first) return first.length > 80 ? `${first.slice(0, 80)}…` : first
  } catch {
    // Not JSON — fall through to the raw snippet.
  }
  const oneLine = args.replace(/\s+/g, ' ').trim()
  return oneLine.length > 80 ? `${oneLine.slice(0, 80)}…` : oneLine
}

/** Pull the shell command out of a shell-ish tool call, when present. */
function extractCommand(name: string, args: string): string | null {
  if (!/bash|shell|run|exec|powershell|cmd/i.test(name)) return null
  try {
    const obj = JSON.parse(args) as Record<string, unknown>
    const v = obj.command ?? obj.cmd
    if (typeof v === 'string' && v) return v
  } catch {
    // Not JSON.
  }
  return null
}

export function ToolCallBlock({ name, arguments: args, result }: ToolCallBlockProps) {
  const [open, setOpen] = useState(false)
  const command = extractCommand(name, args)
  return (
    <div className={`chat-tool${open ? ' open' : ''}`}>
      <button className="chat-tool-head" onClick={() => setOpen((v) => !v)}>
        <span className="chat-tool-icon">🔧</span>
        <span className="chat-tool-title">{name}</span>
        <span className="chat-tool-summary">{summarize(args)}</span>
        {!result && <span className="chat-tool-running">执行中…</span>}
        <span className="chat-tool-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="chat-tool-body">
          {command ? (
            <>
              <div className="chat-tool-cmd">{command}</div>
              {result !== undefined && <pre className="chat-tool-output">{result}</pre>}
            </>
          ) : (
            <>
              <pre>{args}</pre>
              {result !== undefined && <pre className="chat-tool-result">{result}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
