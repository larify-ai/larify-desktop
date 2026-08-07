import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { Application } from '../app/application'
import type { Disposable } from '../infra/disposable'

const channel = 'dialog:pick-directories'

export function registerDialogIpc(application: Application): Disposable {
  ipcMain.handle(channel, async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender) ?? application.window.get()
    const result = await dialog.showOpenDialog(owner, {
      properties: ['openDirectory', 'multiSelections']
    })
    return result.canceled ? [] : result.filePaths
  })

  return { dispose: () => ipcMain.removeHandler(channel) }
}
