// Synthetic IME harness: mimics Kimi-style TUI frames (inverse-space caret on
// the input row, hardware cursor parked on a status row below), shell prompts
// after the TUI exits, and scrollback; fires synthetic composition events and
// reports composition-view geometry + chosen anchors.
import { Terminal } from '@xterm/xterm'
import { attachImeAnchor } from '../../src/renderer/src/imeAnchor'

declare global {
  interface Window {
    imeTest: {
      start(data: string): void
      update(data: string): void
      end(): void
      drawFrame(caretAboveCursor: number): void
      shellPrompt(gapLines: number): void
      fillScrollback(lines: number): void
      feedDump(b64: string): void
      resetAnchors(): void
      measure(): string
    }
  }
}

const ESC = String.fromCharCode(27)
const INV_ON = `${ESC}[7m`
const INV_OFF = `${ESC}[27m`

const container = document.getElementById('term')!
const term = new Terminal({ fontSize: 14, rows: 30, cols: 120 })
term.open(container)

const anchors: unknown[] = []
attachImeAnchor(term, { onAnchor: (a) => anchors.push(a) })

term.write(`${ESC}[2J${ESC}[H`)

// Absolute buffer row of the caret drawn by the last drawFrame call.
let caretAbsRow = -1
const CARET_COL = 2 // "> " occupies cols 0-1, inverse space sits at col 2

function textarea(): HTMLTextAreaElement {
  return document.querySelector('.xterm-helper-textarea')!
}
function view(): HTMLElement {
  return document.querySelector('.composition-view')!
}

window.imeTest = {
  start(data) {
    textarea().dispatchEvent(new CompositionEvent('compositionstart', { data }))
  },
  update(data) {
    textarea().dispatchEvent(new CompositionEvent('compositionupdate', { data }))
  },
  end() {
    textarea().dispatchEvent(new CompositionEvent('compositionend', { data: '' }))
  },

  // Draw a fake TUI frame at the cursor: input row "> ▮" (inverse-space
  // caret), then `caretAboveCursor` status rows below it; the hardware cursor
  // ends at the end of the last status row, like an Ink redraw.
  drawFrame(caretAboveCursor) {
    const b = term.buffer.active
    caretAbsRow = b.baseY + b.cursorY + 1
    let s = `\r\n> ${INV_ON} ${INV_OFF}`
    for (let i = 1; i <= caretAboveCursor; i++) {
      s += `\r\nyolo  K3-256k thinking: high  ~  context: 0% (0/256k) line ${i}`
    }
    term.write(s)
  },

  // TUI exited: shell prints a prompt `gapLines` rows below the old frame;
  // the stale inverse caret stays visible above the cursor.
  shellPrompt(gapLines) {
    term.write('\r\n'.repeat(gapLines) + 'PS C:\\Users\\me> ')
  },

  fillScrollback(lines) {
    let s = ''
    for (let i = 0; i < lines; i++) s += `scroll filler ${i}\r\n`
    term.write(s)
  },

  resetAnchors() {
    anchors.length = 0
  },

  measure() {
    const v = view().getBoundingClientRect()
    const t = textarea().getBoundingClientRect()
    const screen = document.querySelector('.xterm-screen')!.getBoundingClientRect()
    const b = term.buffer.active
    const cellW = screen.width / term.cols
    return JSON.stringify({
      anchors,
      viewText: view().textContent,
      viewRect: { left: Math.round(v.left), top: Math.round(v.top), width: Math.round(v.width) },
      textareaRect: { left: Math.round(t.left), top: Math.round(t.top), width: Math.round(t.width) },
      cellW,
      caretAbsRow,
      caretViewportRow: caretAbsRow - b.viewportY,
      expectedLeft: Math.round(screen.left + CARET_COL * cellW),
      caretCol: CARET_COL,
      cursor: { x: b.cursorX, y: b.cursorY, absY: b.baseY + b.cursorY },
      viewportY: b.viewportY,
      baseY: b.baseY,
      cols: term.cols,
      rows: term.rows
    })
  }
}
