import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../api'
import { terminalRegistry } from '../terminalRegistry'
import { terminalThemes } from '../terminalThemes'
import { useSessionStore } from '../stores/sessionStore'
import { attachImeAnchor } from '../imeAnchor'
import { trackInput } from '../inputTracker'
import type { SessionState } from '../../../shared/types/session'

export function TerminalView({ session, active }: { session: SessionState; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
      fontSize: 14,
      cursorBlink: true,
      scrollback: 5000,
      theme: terminalThemes[useSessionStore.getState().theme]
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term
    fitRef.current = fit
    terminalRegistry.register(session.id, term)

    // Anchor IME preedit/candidate window at the TUI's inverse-video caret
    // cell instead of the transient hardware cursor (Kimi/Codex redraw frames).
    const imeAnchor = attachImeAnchor(term)

    // Shell integration: OSC 9;9;<cwd> emitted by the PowerShell prompt hook
    term.parser.registerOscHandler(9, (data: string) => {
      if (data.startsWith('9;')) {
        const cwd = data.slice(2).replace(/^"|"$/g, '')
        if (cwd) api.reportCwd(session.id, cwd)
      }
      return true
    })

    term.onData((data) => {
      trackInput(session.id, data)
      api.ptyInput(session.id, data)
    })
    term.onResize(({ cols, rows }) => api.ptyResize(session.id, cols, rows))

    // Ctrl+C: copy when there is a selection, otherwise pass through as SIGINT.
    // Ctrl+V: paste clipboard into the PTY. preventDefault is required in both
    // cases: returning false only stops xterm, not the browser's native
    // copy/paste events on the helper textarea (which would double-paste).
    // (Ctrl+Enter / Shift+Enter newline is handled in App.tsx's capture-phase
    // handler, which fires before the IME or xterm can swallow the key.)
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && term.hasSelection()) {
        e.preventDefault()
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      if (key === 'v') {
        e.preventDefault()
        void navigator.clipboard.readText().then((text) => {
          if (text) {
            trackInput(session.id, text)
            api.ptyInput(session.id, text)
          }
        })
        return false
      }
      return true
    })

    // Attach to the PTY and replay any output buffered before this view mounted
    void api.attachTerminal(session.id).then((buffered) => {
      if (buffered) term.write(buffered)
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        // hidden container; fit runs again when the view becomes active
      }
    })
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      terminalRegistry.unregister(session.id)
      imeAnchor.detach()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [session.id])

  // Refit and focus when this view becomes the visible one
  useEffect(() => {
    if (!active) return
    const t = setTimeout(() => {
      try {
        fitRef.current?.fit()
      } catch {
        // ignore
      }
      termRef.current?.focus()
    }, 0)
    return () => clearTimeout(t)
  }, [active])

  return (
    <div
      className="terminal-view"
      data-session-id={session.id}
      style={{ display: active ? 'flex' : 'none' }}
    >
      <div
        ref={containerRef}
        className="terminal-container"
        onContextMenu={(e) => {
          // Right-click pastes into the terminal (Windows Terminal style).
          e.preventDefault()
          void navigator.clipboard.readText().then((text) => {
            if (text) {
              trackInput(session.id, text)
              api.ptyInput(session.id, text)
            }
          })
        }}
      />
      {session.status === 'exited' && (
        <div className="terminal-overlay">
          <div className="overlay-panel">
            <div className="overlay-title">进程已退出{session.exitCode !== undefined ? `（退出码 ${session.exitCode}）` : ''}</div>
            <div className="overlay-subtitle">{session.name} · {session.cwd}</div>
            <div className="overlay-actions">
              <button onClick={() => void api.restartSession(session.id)}>重启</button>
              <button className="danger" onClick={() => void api.closeSession(session.id)}>关闭会话</button>
            </div>
          </div>
        </div>
      )}
      {session.status === 'error' && (
        <div className="terminal-overlay">
          <div className="overlay-panel">
            <div className="overlay-title error">{session.name} 启动失败</div>
            <div className="overlay-subtitle">
              命令：{session.command}
              <br />
              工作目录：{session.cwd}
            </div>
            {session.errorMessage && <div className="overlay-error">{session.errorMessage}</div>}
            <div className="overlay-actions">
              <button onClick={() => void api.restartSession(session.id)}>重试</button>
              <button onClick={() => void api.openAsPowershell(session.id)}>改用 PowerShell 打开</button>
              <button className="danger" onClick={() => void api.closeSession(session.id)}>关闭会话</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
