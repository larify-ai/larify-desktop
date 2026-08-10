import { ipcMain } from 'electron'
import type { UIMessage } from 'ai'
import type { Application } from '../../app/application'
import { defineService } from '@shared/infra/registry'
import { loadAttachments, saveAttachments } from './files'

const attachmentToken = defineService()

export function registerAttachment(application: Application): void {
  ipcMain.handle('attachment:save', (_event, id: string, message: UIMessage) =>
    saveAttachments(id, message)
  )
  ipcMain.handle('attachment:load', (_event, messages: UIMessage[]) => loadAttachments(messages))

  application.registry.register(attachmentToken, {
    dispose() {
      ipcMain.removeHandler('attachment:save')
      ipcMain.removeHandler('attachment:load')
    }
  })
}
