import type { Plugin } from '../../../main/core/plugin/protocol'
import { resourceManagerToken, type ResourceManager } from '../../../main/core/resource'
import { windowToken } from '../../../main/window/token'
import type { MainWindow } from '../../../main/window/types'
import { registerTerminalIpc } from './ipc'
import { TerminalService } from './terminal-service'
import { createTerminalToolkit } from './tools'

const plugin: Plugin = {
  manifest: {
    id: 'terminal',
    description: 'Create terminals, run commands, operate interactive TUIs, and read terminal snapshots.'
  },
  activate(context) {
    const resources = context.registry.get<ResourceManager>(resourceManagerToken)
    if (!resources) throw new Error('ResourceManager is unavailable.')
    const mainWindow = context.registry.get<MainWindow>(windowToken)
    if (!mainWindow) throw new Error('MainWindow is unavailable.')
    const service = new TerminalService(resources)
    context.subscriptions.push({ dispose: () => service.destroy() })
    const unregisterIpc = registerTerminalIpc(service, mainWindow.get())
    context.subscriptions.push({ dispose: unregisterIpc })
    for (const [name, tool] of Object.entries(createTerminalToolkit(service))) {
      context.registerTool(name, tool)
    }
  }
}

export default plugin
