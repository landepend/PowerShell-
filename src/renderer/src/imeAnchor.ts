/**
 * IME anchor heuristic for xterm.js.
 *
 * Originally based on https://github.com/msdshsk/xterm-ime-anchor (MIT
 * License); rewritten to take over xterm's composition positioning instead
 * of racing it with MutationObservers.
 *
 * Problem: xterm.js anchors the IME preedit (.composition-view) and the
 * candidate window (.xterm-helper-textarea) at the *hardware* cursor, and
 * (since upstream #5747) caps the preedit width to the space between the
 * hardware cursor and the right edge. Ink-style TUIs (Kimi/Claude Code,
 * etc.) redraw whole frames and leave the hardware cursor at a transient
 * position (status bar, right box edge), while the visible input caret is
 * drawn as a single inverse-video cell (SGR 7 + ' ') on the input row.
 * Result: IME window far from the input, and the preedit clipped to its
 * last character.
 *
 * Fix: on compositionstart, scan the visible buffer for an isolated inverse
 * cell near the hardware cursor — that is the input caret. While composing
 * with such an anchor, CompositionHelper.updateCompositionElements is
 * intercepted so only caret-cell-derived geometry is ever written to the
 * DOM (no foreign writes -> no races with Chromium's caret-rect sampling).
 * On compositionend the takeover and all !important overrides are released.
 * If no inverse cell exists (normal shells cursor-park correctly), xterm's
 * default behavior runs untouched.
 *
 * Guards against stale frames left by dead TUIs (e.g. exited Kimi):
 * - cursorY is viewport-relative (0 at baseY), so it is converted with
 *   buffer.baseY before comparing — without this, any scrollback rejects
 *   every candidate;
 * - if the cursor row itself looks like a shell prompt (`PS C:\>`,
 *   `C:\>`, `$`, `❯` …), no anchor is used at all;
 * - among candidates the one nearest the cursor row wins, so a live frame
 *   beats an older dead frame within range.
 */

import type { Terminal } from '@xterm/xterm'

export interface ImeAnchor {
  source: 'heuristic' | 'hardware'
  col: number
  row: number
}

export interface ImeAnchorOptions {
  onAnchor?: (anchor: ImeAnchor) => void
  /** Reject inverse cells whose both neighbours are also inverse (selection rows). Default true. */
  requireIsolatedCell?: boolean
  /**
   * Reject inverse cells further than this many rows from the hardware cursor.
   * Must comfortably cover a live TUI frame (input row above a multi-line
   * status area); proximity to a shell prompt is what excludes dead frames,
   * not this distance. Default 10.
   */
  maxRowDistance?: number
}

interface CompositionHelperLike {
  isComposing: boolean
  updateCompositionElements(dontRecurse?: boolean): void
}

interface AnchorRect {
  left: number
  top: number
  maxWidth: number
  cellHeight: number
}

// Inline properties we set with !important while anchored; cleared on release
// so xterm's own (non-important) writes work again for plain shells.
const VIEW_PROPS = ['left', 'top', 'height', 'line-height', 'max-width', 'overflow', 'direction']
const TEXTAREA_PROPS = ['left', 'top', 'width', 'height', 'line-height']

// Shell prompts: `PS C:\..> `, `C:\..>`, `$ `, `❯ `, `>> ` (continuation) …
// Box-drawing chars are excluded so a TUI input row like `│ > text│` never matches.
const SHELL_PROMPT_RE = /^\s*(?:PS\s+)?[^│┃|]*[>»›$#%❯]\s*\S*$/

export function attachImeAnchor(
  terminal: Terminal,
  options: ImeAnchorOptions = {}
): { detach(): void } {
  const { onAnchor, requireIsolatedCell = true, maxRowDistance = 10 } = options

  const root = terminal.element
  if (!root) return { detach() {} }

  // xterm.js stable DOM structure since 4.x:
  // .xterm > .xterm-screen + .xterm-helpers
  //          > .xterm-helper-textarea (IME target) + .composition-view (preedit)
  const textarea = root.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
  const screen = root.querySelector<HTMLElement>('.xterm-screen')
  const compositionView = root.querySelector<HTMLElement>('.composition-view')
  if (!textarea || !screen || !compositionView) return { detach() {} }

  // Reach the internal CompositionHelper (property names survive xterm's build).
  const helper = (terminal as unknown as { _core?: { _compositionHelper?: CompositionHelperLike } })
    ._core?._compositionHelper

  let composing = false
  let anchor: AnchorRect | null = null
  let renderDisposable: { dispose(): void } | null = null

  function computeCellSize(): { w: number; h: number } {
    const rect = screen!.getBoundingClientRect()
    return {
      w: rect.width / Math.max(terminal.cols, 1),
      h: rect.height / Math.max(terminal.rows, 1)
    }
  }

  /**
   * True when the hardware cursor sits on a shell prompt line — a live TUI
   * parks its cursor on a status row instead, so this means "plain shell:
   * don't anchor, xterm's hardware-cursor position is already right".
   */
  function cursorOnShellPrompt(): boolean {
    const buffer = terminal.buffer.active
    const line = buffer.getLine(buffer.baseY + buffer.cursorY)
    if (!line) return false
    const beforeCursor = line.translateToString(true).slice(0, buffer.cursorX)
    return SHELL_PROMPT_RE.test(beforeCursor)
  }

  /**
   * The TUI-drawn caret: the isolated inverse cell nearest to the hardware
   * cursor row. Note buffer.cursorY is viewport-relative (0 at baseY), so it
   * must be converted with baseY — comparing against absolute buffer rows
   * directly breaks as soon as any scrollback exists.
   */
  function findCaretCell(): { col: number; row: number } | null {
    const buffer = terminal.buffer.active
    const startY = buffer.viewportY
    const cursorAbsY = buffer.baseY + buffer.cursorY
    if (cursorOnShellPrompt()) return null
    let best: { col: number; row: number; dist: number } | null = null
    for (let y = startY; y < startY + terminal.rows; y++) {
      const dist = Math.abs(y - cursorAbsY)
      if (dist > maxRowDistance) continue
      if (best && dist >= best.dist) continue
      const line = buffer.getLine(y)
      if (!line) continue
      for (let x = 0; x < line.length; x++) {
        const cell = line.getCell(x)
        if (!cell || !cell.isInverse()) continue
        if (requireIsolatedCell) {
          const left = x > 0 ? line.getCell(x - 1) : undefined
          const right = x + 1 < line.length ? line.getCell(x + 1) : undefined
          if (left?.isInverse() && right?.isInverse()) continue
        }
        best = { col: x, row: y - startY, dist }
        break
      }
    }
    return best && { col: best.col, row: best.row }
  }

  /** Re-scan the buffer and refresh the anchor rect. Keeps the last anchor if the caret vanishes transiently. */
  function updateAnchor(): void {
    const hit = findCaretCell()
    if (!hit) return
    const { w, h } = computeCellSize()
    const left = hit.col * w
    const top = hit.row * h
    const screenWidth = screen!.getBoundingClientRect().width
    const maxWidth = Math.max(screenWidth - left, w)
    if (anchor && anchor.left === left && anchor.top === top && anchor.maxWidth === maxWidth) return
    anchor = { left, top, maxWidth, cellHeight: h }
    onAnchor?.({ source: 'heuristic', col: hit.col, row: hit.row })
  }

  /** Write caret-cell geometry to both IME elements (mirrors xterm's own layout logic). */
  function applyLayout(): void {
    if (!anchor) return
    const view = compositionView!
    const ta = textarea!
    view.style.setProperty('left', `${anchor.left}px`, 'important')
    view.style.setProperty('top', `${anchor.top}px`, 'important')
    view.style.setProperty('height', `${anchor.cellHeight}px`, 'important')
    view.style.setProperty('line-height', `${anchor.cellHeight}px`, 'important')
    const opts = terminal.options
    if (opts.fontFamily) view.style.setProperty('font-family', opts.fontFamily, 'important')
    if (opts.fontSize) view.style.setProperty('font-size', `${opts.fontSize}px`, 'important')
    view.style.setProperty('max-width', `${anchor.maxWidth}px`, 'important')
    view.style.setProperty('overflow', 'hidden', 'important')
    // rtl keeps the end of an over-long preedit (the IME caret side) visible.
    view.style.setProperty('direction', 'rtl', 'important')
    // Sync the textarea to the view's bounds: the browser anchors the IME
    // candidate window to the caret inside this element.
    const b = view.getBoundingClientRect()
    ta.style.setProperty('left', `${anchor.left}px`, 'important')
    ta.style.setProperty('top', `${anchor.top}px`, 'important')
    ta.style.setProperty('width', `${Math.max(b.width, 1)}px`, 'important')
    ta.style.setProperty('height', `${Math.max(b.height, 1)}px`, 'important')
    ta.style.setProperty('line-height', `${Math.max(b.height, 1)}px`, 'important')
  }

  function releaseOverrides(): void {
    for (const p of VIEW_PROPS) compositionView!.style.removeProperty(p)
    for (const p of TEXTAREA_PROPS) textarea!.style.removeProperty(p)
  }

  // Take over composition positioning: while anchored, xterm's
  // hardware-cursor-derived writes never happen.
  let restoreHelper: (() => void) | null = null
  if (helper && typeof helper.updateCompositionElements === 'function') {
    const orig = helper.updateCompositionElements.bind(helper)
    helper.updateCompositionElements = (dontRecurse?: boolean) => {
      if (composing && anchor) {
        applyLayout()
        // Mirror xterm's deferred re-run cadence (IME events are not
        // consistently triggered across browsers).
        if (!dontRecurse) setTimeout(() => helper.updateCompositionElements(true), 0)
        return
      }
      orig(dontRecurse)
    }
    restoreHelper = () => {
      helper.updateCompositionElements = orig
    }
  }

  function onCompositionStart(): void {
    composing = true
    updateAnchor()
    if (anchor) {
      applyLayout()
    } else {
      // Normal shell: hardware-cursor anchor is already correct.
      onAnchor?.({
        source: 'hardware',
        col: terminal.buffer.active.cursorX,
        row: terminal.buffer.active.cursorY
      })
    }
    // Follow redraws during composition (partial-commit redraws the caret).
    renderDisposable = terminal.onRender(() => {
      if (!composing) return
      updateAnchor()
    })
  }

  function onCompositionEnd(): void {
    composing = false
    anchor = null
    releaseOverrides()
    renderDisposable?.dispose()
    renderDisposable = null
  }

  textarea.addEventListener('compositionstart', onCompositionStart)
  textarea.addEventListener('compositionend', onCompositionEnd)

  return {
    detach() {
      composing = false
      anchor = null
      releaseOverrides()
      renderDisposable?.dispose()
      renderDisposable = null
      restoreHelper?.()
      textarea.removeEventListener('compositionstart', onCompositionStart)
      textarea.removeEventListener('compositionend', onCompositionEnd)
    }
  }
}
