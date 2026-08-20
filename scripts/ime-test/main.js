// Electron driver for the synthetic IME harness. Not part of the app.
// Phase 1: live TUI frame -> anchor must latch onto the inverse caret.
// Phase 2: TUI exited, shell prompt close below the dead frame -> must NOT
//          anchor (shell-prompt guard), even though the dead caret is within
//          maxRowDistance.
// Phase 3: TUI relaunched with a tall status area (caret 6 rows above the
//          cursor) -> must anchor again.
// Phase 4: scrollback exists (baseY > 0) -> must still anchor; regression
//          test for the cursorY/baseY coordinate bug.
const { app, BrowserWindow } = require('electron')
const path = require('path')

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1000, height: 600 })
  await win.loadFile(path.join(__dirname, 'index.html'))
  await new Promise((r) => setTimeout(r, 800))

  const run = (js) => win.webContents.executeJavaScript(js)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let failures = 0

  async function compose(text) {
    await run(`imeTest.start(${JSON.stringify(text[0])})`)
    for (let i = 2; i <= text.length; i++) {
      await run(`imeTest.update(${JSON.stringify(text.slice(0, i))})`)
      await sleep(50)
    }
    await sleep(300)
  }

  async function check(phase, expectHeuristic) {
    const m = JSON.parse(await run('imeTest.measure()'))
    const last = m.anchors[m.anchors.length - 1]
    let ok = last && last.source === (expectHeuristic ? 'heuristic' : 'hardware')
    if (ok && expectHeuristic) {
      ok =
        Math.abs(m.viewRect.left - m.expectedLeft) <= m.cellW * 1.5 &&
        last.row === m.caretViewportRow &&
        last.col === m.caretCol
    }
    console.log(
      `${ok ? 'ok' : 'FAIL'} ${phase}: anchor=${JSON.stringify(last)} ` +
        `view=(${m.viewRect.left},${m.viewRect.top}) expectedLeft=${m.expectedLeft} ` +
        `caretRow=${m.caretViewportRow} cursor=${JSON.stringify(m.cursor)} baseY=${m.baseY}`
    )
    if (!ok) failures++
    await run('imeTest.end()')
    await run('imeTest.resetAnchors()')
  }

  // Phase 1
  await run('imeTest.drawFrame(2)')
  await sleep(300)
  await compose("ni'hao'ya")
  await check('phase1 live frame', true)

  // Phase 2: prompt only 2 rows below the status line -> dead caret ~4 rows
  // above the cursor, inside maxRowDistance; only the prompt guard rejects it.
  await run('imeTest.shellPrompt(2)')
  await sleep(300)
  await compose('ni')
  await check('phase2 shell prompt', false)

  // Phase 3: relaunch with a 6-row-tall status area.
  await run('imeTest.drawFrame(6)')
  await sleep(300)
  await compose('ni')
  await check('phase3 relaunch tall frame', true)

  // Phase 4: exit again, push 40 lines of scrollback (baseY > 0), relaunch.
  await run('imeTest.shellPrompt(1)')
  await sleep(200)
  await run('imeTest.fillScrollback(40)')
  await sleep(300)
  await run('imeTest.drawFrame(3)')
  await sleep(300)
  await compose('ni')
  await check('phase4 scrollback live frame', true)

  app.exit(failures ? 1 : 0)
})
