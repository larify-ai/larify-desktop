import { ipcMain, type BrowserWindow } from 'electron'
import type { WorkspaceManager } from './manager'

const channels = ['workspace:list', 'workspace:reveal'] as const

export function registerWorkspaceIpc(manager: WorkspaceManager, window: BrowserWindow): () => void {
  const unbindChange = manager.bindChange((resourceId, directory) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('workspace:change', resourceId, directory)
    }
  })
  for (const channel of channels) ipcMain.removeHandler(channel)
  ipcMain.handle('workspace:list', (_event, id: number, directory?: string) =>
    manager.list(id, directory)
  )
  ipcMain.handle('workspace:reveal', (_event, id: number, file: string) => manager.reveal(id, file))

  return () => {
    unbindChange()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
