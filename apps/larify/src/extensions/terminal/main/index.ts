import type { BrowserWindow } from 'electron'
import type { Extension } from '@shared/extension'
import { registerTerminalIpc } from './ipc'
import { TerminalService } from './terminal-service'
import { createTerminalToolkit } from './tools'
import type { SessionResource } from '../../../main/utils/session-resource'

interface MainWindowService {
  get(): BrowserWindow
}

const extension: Extension = {
  activate(app, context) {
    const service = new TerminalService()
    const mainWindow = app.get<MainWindowService>('service', 'main-window')
    if (!mainWindow) throw new Error('main-window service is not registered')
    const unregisterIpc = registerTerminalIpc(service, mainWindow.get())
    app.register('tool', 'terminal', createTerminalToolkit(service))
    app.register('session-resource', 'terminal', service satisfies SessionResource)
    context.subscriptions.push({
      dispose: () => {
        unregisterIpc()
        return service.destroy()
      }
    })
  }
}

export default extension
