import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '../shared/ipc'
import type { CreateProjectInput, PssApi } from '../shared/types/api'
import type { AppState, CliKind, SessionType, ThemeName } from '../shared/types/session'
import type { ChatAttachment, ChatEvent, CreateChatInput } from '../shared/types/chat'

const api: PssApi = {
  getState: () => ipcRenderer.invoke(IPC.GetState),
  createSession: (type: SessionType, name?: string, cwd?: string) =>
    ipcRenderer.invoke(IPC.SessionCreate, type, name, cwd),
  closeSession: (id: string) => ipcRenderer.invoke(IPC.SessionClose, id),
  renameSession: (id: string, name: string) => ipcRenderer.invoke(IPC.SessionRename, id, name),
  duplicateSession: (id: string) => ipcRenderer.invoke(IPC.SessionDuplicate, id),
  restartSession: (id: string) => ipcRenderer.invoke(IPC.SessionRestart, id),
  reorderSessions: (orderedIds: string[]) => ipcRenderer.invoke(IPC.SessionReorder, orderedIds),
  setActiveSession: (id: string) => ipcRenderer.invoke(IPC.SessionSetActive, id),
  reportCwd: (id: string, cwd: string) => ipcRenderer.send(IPC.SessionReportCwd, id, cwd),
  openAsPowershell: (id: string) => ipcRenderer.invoke(IPC.SessionOpenAsPowershell, id),
  togglePin: (id: string) => ipcRenderer.invoke(IPC.SessionTogglePin, id),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke(IPC.ProjectCreate, input),
  addSessionToProject: (projectId: string) => ipcRenderer.invoke(IPC.ProjectAddSession, projectId),
  deleteProject: (projectId: string) => ipcRenderer.invoke(IPC.ProjectDelete, projectId),
  toggleProjectCollapsed: (projectId: string) =>
    ipcRenderer.invoke(IPC.ProjectToggleCollapsed, projectId),
  pickFolder: () => ipcRenderer.invoke(IPC.DialogPickFolder),
  getCliOptions: (cli: CliKind) => ipcRenderer.invoke(IPC.CliOptions, cli),
  openDataFolder: () => ipcRenderer.invoke(IPC.OpenDataFolder),
  getKimiUsage: () => ipcRenderer.invoke(IPC.KimiUsage),
  getAppInfo: () => ipcRenderer.invoke(IPC.AppInfo),
  attachTerminal: (id: string) => ipcRenderer.invoke(IPC.TerminalAttach, id),
  ptyInput: (id: string, data: string) => ipcRenderer.send(IPC.PtyInput, id, data),
  ptyResize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.PtyResize, id, cols, rows),
  openFolder: (path: string) => ipcRenderer.invoke(IPC.OpenFolder, path),
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OpenExternal, url),
  setSidebarWidth: (width: number) => ipcRenderer.send(IPC.SetSidebarWidth, width),
  setTheme: (theme: ThemeName) => ipcRenderer.send(IPC.SetTheme, theme),
  focusWindow: () => ipcRenderer.send(IPC.FocusWindow),
  onStateChanged: (cb: (state: AppState) => void) => {
    const listener = (_e: IpcRendererEvent, state: AppState) => cb(state)
    ipcRenderer.on(IPC.StateChanged, listener)
    return () => ipcRenderer.removeListener(IPC.StateChanged, listener)
  },
  onPtyData: (cb: (id: string, data: string) => void) => {
    const listener = (_e: IpcRendererEvent, id: string, data: string) => cb(id, data)
    ipcRenderer.on(IPC.PtyData, listener)
    return () => ipcRenderer.removeListener(IPC.PtyData, listener)
  },
  createChat: (input: CreateChatInput) => ipcRenderer.invoke(IPC.ChatCreate, input),
  sendChat: (chatId: string, text: string, attachments?: ChatAttachment[]) =>
    ipcRenderer.invoke(IPC.ChatSend, chatId, text, attachments),
  cancelChat: (chatId: string) => ipcRenderer.invoke(IPC.ChatCancel, chatId),
  getChatHistory: (chatId: string) => ipcRenderer.invoke(IPC.ChatHistory, chatId),
  renameChat: (chatId: string, title: string) => ipcRenderer.invoke(IPC.ChatRename, chatId, title),
  deleteChat: (chatId: string) => ipcRenderer.invoke(IPC.ChatDelete, chatId),
  setChatModel: (chatId: string, model: string | undefined) =>
    ipcRenderer.invoke(IPC.ChatSetModel, chatId, model),
  setChatEffort: (chatId: string, effort: string | undefined) =>
    ipcRenderer.invoke(IPC.ChatSetEffort, chatId, effort),
  togglePinChat: (chatId: string) => ipcRenderer.invoke(IPC.ChatTogglePin, chatId),
  openChatInTerminal: (chatId: string) => ipcRenderer.invoke(IPC.ChatOpenInTerminal, chatId),
  pickFiles: () => ipcRenderer.invoke(IPC.DialogPickFiles),
  saveAttachment: (name: string, data: Uint8Array) =>
    ipcRenderer.invoke(IPC.ChatAttachSave, name, data),
  attachmentForPath: (path: string) => ipcRenderer.invoke(IPC.ChatAttachPath, path),
  attachmentUrl: (path: string) => 'pss-attachment://open?p=' + encodeURIComponent(path),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  onChatEvent: (cb: (chatId: string, event: ChatEvent) => void) => {
    const listener = (_e: IpcRendererEvent, chatId: string, event: ChatEvent) => cb(chatId, event)
    ipcRenderer.on(IPC.ChatEvent, listener)
    return () => ipcRenderer.removeListener(IPC.ChatEvent, listener)
  }
}

contextBridge.exposeInMainWorld('pss', api)
