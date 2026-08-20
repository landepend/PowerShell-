import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import { cpSync, existsSync } from 'fs'
import { userInfo } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { IPC } from '../shared/ipc'
import { Logger } from './logger'
import { registerIpcHandlers } from './ipc/terminal.ipc'
import { registerChatIpcHandlers } from './ipc/chat.ipc'
import { PtyManager } from './terminal/PtyManager'
import { SessionManager } from './terminal/SessionManager'
import { ShellIntegration } from './terminal/ShellIntegration'
import { WorkspaceManager } from './workspace/WorkspaceManager'
import { ChatRunner } from './chat/ChatRunner'
import { ChatManager } from './chat/ChatManager'
import { isImagePath } from './chat/attachments'
import { getCliOptions } from './terminal/CliConfigReader'
import { getKimiUsage } from './terminal/KimiUsage'
import type { CliKind } from '../shared/types/session'

// Custom scheme for chat image previews in the renderer
// (pss-attachment://open?p=<encodeURIComponent(absolutePath)>).
// Must be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'pss-attachment', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

// One-time migration for the PowerShellShell -> PowerShell++ rename: the new
// productName moves userData to %APPDATA%\PowerShell++, so carry the old data
// over on first run. Keeps sessions, theme and logs intact across the rename.
if (app.isPackaged) {
  const oldBase = join(app.getPath('appData'), 'PowerShellShell')
  const newBase = app.getPath('userData')
  try {
    for (const dir of ['data', 'logs']) {
      const from = join(oldBase, dir)
      const to = join(newBase, dir)
      if (existsSync(from) && !existsSync(to)) cpSync(from, to, { recursive: true })
    }
  } catch {
    // migration is best-effort; a fresh start is still safe
  }
}

// Data lives next to the project in dev (easy debugging), in userData when packaged.
const baseDir = app.isPackaged ? app.getPath('userData') : app.getAppPath()
if (!app.isPackaged) {
  // Isolate Chromium's userData in dev: otherwise dev and the packaged app
  // share %APPDATA%/<name> (case-insensitive), and the single-instance lock
  // silently blocks `npm run dev` while the packaged app is running.
  app.setPath('userData', join(baseDir, 'data', '.chromium'))
}
const dataDir = join(baseDir, 'data')
const logger = new Logger(join(baseDir, 'logs', 'app.log'))

let win: BrowserWindow | null = null
let shuttingDown = false

function bootstrap(): void {
  const workspace = new WorkspaceManager(dataDir, logger, app.getVersion())
  const shellIntegration = new ShellIntegration(dataDir, logger)
  const ptyManager = new PtyManager(logger, (id, data) => {
    win?.webContents.send(IPC.PtyData, id, data)
  })
  const sessions = new SessionManager(
    { workspace, pty: ptyManager, shellIntegration, logger },
    (state) => {
      // Frameless window: keep the native overlay buttons in sync with theme.
      const light = state.theme === 'light'
      win?.setTitleBarOverlay({
        color: light ? '#ffffff' : '#151517',
        symbolColor: light ? '#1b1b1c' : '#f9fafb',
        height: 36
      })
      win?.webContents.send(IPC.StateChanged, state)
    }
  )
  const chatRunner = new ChatRunner(dataDir, logger)
  const chats = new ChatManager(
    {
      workspace,
      sessions,
      pty: ptyManager,
      runner: chatRunner,
      logger,
      forwardEvent: (chatId, ev) => win?.webContents.send(IPC.ChatEvent, chatId, ev)
    },
    () => win?.webContents.send(IPC.StateChanged, sessions.getState())
  )

  registerIpcHandlers(sessions)
  registerChatIpcHandlers(chats, dataDir)
  ipcMain.on(IPC.FocusWindow, () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  ipcMain.handle(IPC.DialogPickFolder, async () => {
    if (!win) return null
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.DialogPickFiles, async () => {
    if (!win) return []
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '图片和文档',
          extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'pdf', 'md', 'txt']
        },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    return r.canceled ? [] : r.filePaths
  })
  // Serve chat image attachments to the renderer; images only, anything
  // else (or a missing file) gets a 404.
  protocol.handle('pss-attachment', (request) => {
    try {
      const p = decodeURIComponent(new URL(request.url).searchParams.get('p') ?? '')
      if (!p || !isImagePath(p) || !existsSync(p)) {
        return new Response('not found', { status: 404 })
      }
      return net.fetch(pathToFileURL(p).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
  ipcMain.handle(IPC.CliOptions, (_e, cli: CliKind) => getCliOptions(cli, logger).then((o) => o.models))
  ipcMain.handle(IPC.OpenDataFolder, () => shell.openPath(dataDir))
  ipcMain.handle(IPC.KimiUsage, () => getKimiUsage(logger))
  ipcMain.handle(IPC.AppInfo, () => ({
    version: app.getVersion(),
    dataDir,
    userName: userInfo().username
  }))

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: workspace.state.ui.theme === 'light' ? '#ffffff' : '#0b0d12',
    title: 'PowerShell++',
    // Frameless with native overlay controls (min/max/close top-right);
    // drag regions come from CSS (-webkit-app-region).
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: workspace.state.ui.theme === 'light' ? '#ffffff' : '#151517',
      symbolColor: workspace.state.ui.theme === 'light' ? '#1b1b1c' : '#f9fafb',
      height: 36
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })

  // Surface renderer errors (black-screen crashes) in app.log.
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    if (/error|uncaught|warning: invalid/i.test(message)) {
      logger.log('Renderer Console', `${message} @ ${sourceId}:${line}`)
    }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    logger.log('Renderer Gone', JSON.stringify(details))
  })

  win.on('close', (e) => {
    if (shuttingDown) return
    e.preventDefault()
    shuttingDown = true
    // Snapshot running CLIs + flush workspace before tearing down PTYs.
    chatRunner.killAll()
    void sessions.shutdown().finally(() => win?.destroy())
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Restore persisted sessions (PTYs spawn now; output is buffered until the UI attaches).
  sessions.restore()

  win.on('closed', () => {
    win = null
  })

  if (process.env.PSS_SMOKE) {
    setTimeout(() => {
      logger.log('Smoke Test Complete', JSON.stringify(sessions.getState().sessions.map((s) => s.id)))
      // go through the real close path (flush workspace + kill all PTYs)
      win?.close()
    }, 8000)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    logger.log('Application Start', `version=${app.getVersion()} packaged=${app.isPackaged}`)
    bootstrap()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    if (shuttingDown) return
    shuttingDown = true
    // last-resort flush if the window close handler did not run
    win = null
  })
}
