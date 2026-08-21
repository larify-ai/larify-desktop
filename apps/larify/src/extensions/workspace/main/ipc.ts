import { ipcMain, type BrowserWindow, type IpcMainEvent, type Rectangle } from 'electron'
import { stat } from 'node:fs/promises'
import type { WorkspaceManager } from './manager'
import type { NativePreviewManager } from './native-preview-manager'

const channels = [
  'workspace:inspect',
  'workspace:path-kind',
  'workspace:list',
  'workspace-preview:open',
  'workspace:read',
  'workspace:read-asset',
  'workspace:reveal'
] as const

export function registerWorkspaceIpc(
  manager: WorkspaceManager,
  previews: NativePreviewManager,
  window: BrowserWindow
): () => void {
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
  ipcMain.handle(
    'workspace-preview:open',
    (
      _event,
      id: number,
      path: string,
      mime: string,
      background: string,
      bounds: Rectangle,
      visible: boolean
    ) => previews.open(id, path, mime, background, bounds, visible)
  )
  const setBoundsSync = (event: IpcMainEvent, id: number, bounds: Rectangle): void => {
    previews.setBounds(id, bounds)
    event.returnValue = true
  }
  const setVisible = (_event: IpcMainEvent, id: number, visible: boolean): void => {
    previews.setVisible(id, visible)
  }
  const closePreview = (_event: IpcMainEvent, id: number): void => {
    previews.close(id)
  }
  ipcMain.on('workspace-preview:setBoundsSync', setBoundsSync)
  ipcMain.on('workspace-preview:setVisible', setVisible)
  ipcMain.on('workspace-preview:close', closePreview)

  return () => {
    unbindChange()
    ipcMain.removeListener('workspace-preview:setBoundsSync', setBoundsSync)
    ipcMain.removeListener('workspace-preview:setVisible', setVisible)
    ipcMain.removeListener('workspace-preview:close', closePreview)
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}
