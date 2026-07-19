import type { BrowserWindow } from "electron"
import type { Extension } from "kernel"
import { registerBrowserIpc } from "./ipc"
import { BrowserTabManager } from "./tab-manager"

interface MainWindowService {
  get(): BrowserWindow
}

const extension: Extension = {
  activate(app, context) {
    let manager: BrowserTabManager | null = null
    const getManager = (): BrowserTabManager => {
      if (manager) return manager
      const mainWindow = app.get<MainWindowService>("service", "main-window")
      if (!mainWindow) throw new Error("main-window service is not registered")
      manager = new BrowserTabManager(mainWindow.get())
      return manager
    }

    const unregisterIpc = registerBrowserIpc(getManager)
    context.subscriptions.push({
      dispose: () => {
        unregisterIpc()
        manager?.destroy()
      },
    })
  },
}

export default extension
