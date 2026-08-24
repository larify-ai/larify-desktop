import { ipcMain, type BrowserWindow } from 'electron'
import { stat } from 'node:fs/promises'
import type { WorkspaceManager } from './manager'

const channels = [
  'workspace:inspect',
  'workspace:path-kind',
  'workspace:list',
  'workspace:read',
  'workspace:read-asset',
  'workspace:reveal',
  'workspace:set-active-session'
] as const

export function registerWorkspaceIpc(manager: WorkspaceManager, window: BrowserWindow): () => void {
  const unbindChange = manager.bindChange((resourceId, directory, changedPath) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send('workspace:change', resourceId, directory, changedPath)
    }
  })
  for (const channel of channels) ipcMain.removeHandler(channel)
  ipcMain.handle('workspace:list', (_event, id: number, directory?: string) =>
    manager.list(id, directory)
  )
  ipcMain.handle('workspace:inspect', (_event, id: number, file: string) =>
    manager.inspectFile(id, file)
  )
  ipcMain.handle('workspace:path-kind', async (_event, file: string) =>
    (await stat(file)).isDirectory() ? 'directory' : 'file'
  )
  ipcMain.handle('workspace:read', (_event, id: number, file: string) => manager.readFile(id, file))
  ipcMain.handle('workspace:read-asset', (_event, id: number, file: string) =>
    manager.readAsset(id, file)
  )
  ipcMain.handle('workspace:reveal', (_event, id: number, file: string) => manager.reveal(id, file))
  ipcMain.handle('workspace:set-active-session', (_event, sessionId: string) =>
    manager.setActiveSession(sessionId)
  )
  return () => {
    unbindChange()
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
