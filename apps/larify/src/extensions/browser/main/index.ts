import type { Plugin } from '../../../main/core/plugin/protocol'
import { resourceManagerToken, type ResourceManager } from '../../../main/core/resource'
import { windowToken } from '../../../main/window/token'
import type { MainWindow } from '../../../main/window/types'
import { BrowserService } from './browser-service'
import { registerBrowserIpc } from './ipc'
import { createBrowserTools } from './tools'

const plugin: Plugin = {
  manifest: {
    id: 'browser',
    description: 'Search and fetch web content in temporary tabs; create, list, close, and navigate persistent tabs; inspect pages and elements; run JavaScript and debug with CDP, console messages, and page errors; interact with pages and forms; upload and download files; control keyboard and mouse input; capture screenshots, save pages as PDFs, and record tab videos.'
  },
  activate(context) {
    const resources = context.registry.get<ResourceManager>(resourceManagerToken)
    if (!resources) throw new Error('ResourceManager is unavailable.')
    const mainWindow = context.registry.get<MainWindow>(windowToken)
    if (!mainWindow) throw new Error('MainWindow is unavailable.')
    const service = new BrowserService(mainWindow.get(), resources)
    context.subscriptions.push({ dispose: () => service.destroy() })
    context.subscriptions.push({ dispose: registerBrowserIpc(service) })
    for (const [name, tool] of Object.entries(createBrowserTools(service))) {
      context.registerTool(name, tool)
    }
  }
}

export default plugin
