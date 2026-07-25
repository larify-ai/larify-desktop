import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { WorkspaceService } from './workspace-service'

export function registerWorkspaceIpc(service: WorkspaceService): () => void {
  const subscribers = new Set<WebContents>()
  const subscribe = (event: IpcMainInvokeEvent): void => {
    const sender = event.sender
    if (subscribers.has(sender)) return
    subscribers.add(sender)
    sender.once('destroyed', () => subscribers.delete(sender))
  }
  const sendChange = (event: unknown, path: string): void => {
    for (const sender of subscribers) {
      if (sender.isDestroyed()) subscribers.delete(sender)
      else sender.send('workspace:change', event, path)
    }
  }
  const handlers = {
    'workspace:open': (event: IpcMainInvokeEvent, root: string) => {
      subscribe(event)
      return service.open(root, sendChange)
    },
    'workspace:list': (_event: IpcMainInvokeEvent, directory?: string) => service.list(directory),
    'workspace:stat': (_event: IpcMainInvokeEvent, path: string) => service.stat(path),
    'workspace:read': (_event: IpcMainInvokeEvent, file: string) => service.read(file),
    'workspace:write': (_event: IpcMainInvokeEvent, file: string, content: Uint8Array) =>
      service.write(file, content)
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
    subscribers.clear()
  }
}
