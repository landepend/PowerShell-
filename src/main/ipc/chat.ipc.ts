import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ChatAttachment, CreateChatInput } from '../../shared/types/chat'
import type { ChatManager } from '../chat/ChatManager'
import { attachmentForPath, saveAttachment } from '../chat/attachments'

export function registerChatIpcHandlers(chats: ChatManager, dataDir: string): void {
  ipcMain.handle(IPC.ChatCreate, (_e, input: CreateChatInput) => chats.create(input))
  ipcMain.handle(
    IPC.ChatSend,
    (_e, chatId: string, text: string, attachments?: ChatAttachment[]) =>
      chats.send(chatId, text, attachments)
  )
  ipcMain.handle(IPC.ChatCancel, (_e, chatId: string) => chats.cancel(chatId))
  ipcMain.handle(IPC.ChatHistory, (_e, chatId: string) => chats.history(chatId))
  ipcMain.handle(IPC.ChatRename, (_e, chatId: string, title: string) =>
    chats.rename(chatId, title)
  )
  ipcMain.handle(IPC.ChatDelete, (_e, chatId: string) => chats.delete(chatId))
  ipcMain.handle(IPC.ChatSetModel, (_e, chatId: string, model: string | undefined) =>
    chats.setModel(chatId, model)
  )
  ipcMain.handle(IPC.ChatSetEffort, (_e, chatId: string, effort: string | undefined) =>
    chats.setEffort(chatId, effort)
  )
  ipcMain.handle(IPC.ChatTogglePin, (_e, chatId: string) => chats.togglePin(chatId))
  ipcMain.handle(IPC.ChatOpenInTerminal, (_e, chatId: string) => chats.openInTerminal(chatId))
  ipcMain.handle(IPC.ChatAttachSave, (_e, name: string, data: Uint8Array) =>
    saveAttachment(dataDir, name, data)
  )
  ipcMain.handle(IPC.ChatAttachPath, (_e, path: string) => attachmentForPath(path))
}
