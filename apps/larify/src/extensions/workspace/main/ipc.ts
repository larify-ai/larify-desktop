import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'
import type { WorkspaceService } from './workspace-service'
import type { WorkspaceEditorHost } from './workspace-editor-host'

const optionalFile = async <T>(operation: () => Promise<T>): Promise<T | null> => {
  try {
    return await operation()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function registerWorkspaceIpc(
  service: WorkspaceService,
  getEditor?: () => WorkspaceEditorHost
): () => void {
  const subscribers = new Set<WebContents>()
  const subscriberDisposers = new Map<WebContents, () => void>()
  let activeFile: string | null = null
  const subscribe = (event: IpcMainInvokeEvent): void => {
    const sender = event.sender
    if (subscribers.has(sender)) return
    subscribers.add(sender)
    const onDestroyed = (): void => {
      subscribers.delete(sender)
      subscriberDisposers.delete(sender)
    }
    subscriberDisposers.set(sender, () => sender.removeListener('destroyed', onDestroyed))
    sender.once('destroyed', onDestroyed)
  }
  const broadcast = (channel: string, ...args: unknown[]): void => {
    for (const sender of subscribers) {
      if (sender.isDestroyed()) subscribers.delete(sender)
      else sender.send(channel, ...args)
    }
  }
  const sendChange = (event: unknown, path: string): void =>
    broadcast('workspace:change', event, path)
  const handlers = {
    'workspace:open': (event: IpcMainInvokeEvent, root: string) => {
      subscribe(event)
      return service.open(root, sendChange)
    },
    'workspace:list': (_event: IpcMainInvokeEvent, directory?: string) => service.list(directory),
    'workspace:git-status': () => service.getGitStatuses(),
    'workspace:stat': (_event: IpcMainInvokeEvent, path: string) =>
      optionalFile(() => service.stat(path)),
    'workspace:file-open': (_event: IpcMainInvokeEvent, file: string) =>
      optionalFile(() => service.openFile(file)),
    'workspace:file-allow': (_event: IpcMainInvokeEvent, file: string) => service.allowFile(file),
    'workspace:file-read': (
      _event: IpcMainInvokeEvent,
      handle: number,
      position: number,
      length: number
    ) => service.readFile(handle, position, length),
    'workspace:file-close': (_event: IpcMainInvokeEvent, handle: number) =>
      service.closeFile(handle),
    'workspace:write': (_event: IpcMainInvokeEvent, file: string, content: Uint8Array) =>
      service.write(file, content),
    'workspace-editor:ready': () => getEditor?.().markReady() ?? [],
    'workspace-editor:set-bounds': (_event: IpcMainInvokeEvent, bounds: Electron.Rectangle) =>
      getEditor?.().setBounds(bounds),
    'workspace-editor:set-visible': (_event: IpcMainInvokeEvent, visible: boolean) =>
      getEditor?.().setVisible(visible),
    'workspace-editor:command': (
      _event: IpcMainInvokeEvent,
      command: Parameters<WorkspaceEditorHost['send']>[0]
    ) => getEditor?.().send(command),
    'workspace-editor:state': (event: IpcMainInvokeEvent) => {
      subscribe(event)
      return { activeFile }
    },
    'workspace-editor:active': (_event: IpcMainInvokeEvent, file: string | null) => {
      activeFile = file
      broadcast('workspace-editor:active', file)
    },
    'workspace-editor:reveal': (_event: IpcMainInvokeEvent, path: string) => {
      broadcast('workspace-editor:reveal', path)
    }
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
    for (const dispose of subscriberDisposers.values()) dispose()
    subscriberDisposers.clear()
    subscribers.clear()
  }
}
