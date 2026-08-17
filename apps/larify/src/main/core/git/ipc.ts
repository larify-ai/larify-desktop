import { ipcMain } from 'electron'
import { defineService } from '@shared/infra/registry'
import type { Application } from '../../app/application'
import { head } from './head'
import { status } from './status'

const gitIpcToken = defineService()

export function registerGit(application: Application): void {
  ipcMain.handle('git:status', async (_event, root: string, includeIgnored = true) => {
    try {
      return await status(root, undefined, includeIgnored)
    } catch {
      return []
    }
  })
  ipcMain.handle('git:original', (_event, root: string, file: string) => head(root, file))
  application.registry.register(gitIpcToken, {
    dispose: () => {
      ipcMain.removeHandler('git:status')
      ipcMain.removeHandler('git:original')
    }
  })
}
