import { ipcMain, type BrowserWindow } from 'electron'
import type { ResourceQuery } from '@shared/resource'
import type { ResourceManager } from './manager'

const channels = [
  'resource:create',
  'resource:list',
  'resource:close',
  'resource:close-many'
] as const

export function registerResourceIpc(manager: ResourceManager, window: BrowserWindow): () => void {
  const send = (): void => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('resource:change', manager.list())
    }
  }

  const unbindChange = manager.bindChange(send)
  ipcMain.handle('resource:create', (_event, type: string, sessionId: string, options?: unknown) =>
    manager.create(type, sessionId, options)
  )
  ipcMain.handle('resource:list', (_event, query?: ResourceQuery) => manager.list(query))
  ipcMain.handle('resource:close', (_event, id: number) => manager.close(id))
  ipcMain.handle('resource:close-many', (_event, ids: number[]) => manager.closeMany(ids))

  return () => {
    unbindChange()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
