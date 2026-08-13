import { ipcMain, type BrowserWindow } from 'electron'
import type { WorkspaceManager } from './manager'

const channel = 'workspace:list'

export function registerWorkspaceIpc(manager: WorkspaceManager, window: BrowserWindow): () => void {
  const unbindChange = manager.bindChange((resourceId, event, path) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('workspace:change', resourceId, event, path)
    }
  })
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, (_event, id: number, directory?: string) => manager.list(id, directory))

  return () => {
    unbindChange()
    ipcMain.removeHandler(channel)
  }
}
