import type { Extension } from 'kernel'
import { registerTerminalIpc } from './ipc'
import { TerminalService } from './terminal-service'
import { createTerminalToolkit } from './tools'

const extension: Extension = {
  activate(app, context) {
    const service = new TerminalService()
    const unregisterIpc = registerTerminalIpc(service)
    context.subscriptions.push(app.register('tool', 'terminal', createTerminalToolkit(service)))
    context.subscriptions.push({
      dispose: () => {
        unregisterIpc()
        return service.destroy()
      }
    })
  }
}

export default extension
