import { ipcMain, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SessionType, ThemeName } from '../../shared/types/session'
import type { CreateProjectInput } from '../../shared/types/api'
import type { SessionManager } from '../terminal/SessionManager'

export function registerIpcHandlers(sessions: SessionManager): void {
  ipcMain.handle(IPC.GetState, () => sessions.getState())

  ipcMain.handle(IPC.SessionCreate, (_e, type: SessionType, name?: string, cwd?: string) =>
    sessions.create(type, name, cwd)
  )
  ipcMain.handle(IPC.SessionClose, (_e, id: string) => sessions.close(id))
  ipcMain.handle(IPC.SessionRename, (_e, id: string, name: string) => sessions.rename(id, name))
  ipcMain.handle(IPC.SessionDuplicate, (_e, id: string) => sessions.duplicate(id))
  ipcMain.handle(IPC.SessionRestart, (_e, id: string) => sessions.restart(id))
  ipcMain.handle(IPC.SessionReorder, (_e, orderedIds: string[]) => sessions.reorder(orderedIds))
  ipcMain.handle(IPC.SessionSetActive, (_e, id: string) => sessions.setActive(id))
  ipcMain.handle(IPC.SessionOpenAsPowershell, (_e, id: string) => sessions.openAsPowershell(id))
  ipcMain.handle(IPC.SessionTogglePin, (_e, id: string) => sessions.togglePin(id))
  ipcMain.handle(IPC.ProjectCreate, (_e, input: CreateProjectInput) =>
    sessions.createProject(input)
  )
  ipcMain.handle(IPC.ProjectAddSession, (_e, projectId: string) =>
    sessions.createInProject(projectId)
  )
  ipcMain.handle(IPC.ProjectDelete, (_e, projectId: string) => sessions.deleteProject(projectId))
  ipcMain.handle(IPC.ProjectToggleCollapsed, (_e, projectId: string) =>
    sessions.toggleProjectCollapsed(projectId)
  )
  ipcMain.handle(IPC.TerminalAttach, (_e, id: string) => sessions.attachTerminal(id))

  ipcMain.on(IPC.SessionReportCwd, (_e, id: string, cwd: string) => sessions.reportCwd(id, cwd))
  ipcMain.on(IPC.PtyInput, (_e, id: string, data: string) => sessions.input(id, data))
  ipcMain.on(IPC.PtyResize, (_e, id: string, cols: number, rows: number) => sessions.resize(id, cols, rows))
  ipcMain.on(IPC.SetSidebarWidth, (_e, width: number) => sessions.setSidebarWidth(width))
  ipcMain.on(IPC.SetTheme, (_e, theme: ThemeName) => sessions.setTheme(theme))

  ipcMain.handle(IPC.OpenFolder, async (_e, path: string) => {
    if (typeof path === 'string' && path) await shell.openPath(path)
  })
  // Only http(s) leaves the app; everything else is ignored.
  ipcMain.handle(IPC.OpenExternal, async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
}
