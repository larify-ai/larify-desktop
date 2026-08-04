import type { BrowserWindow } from "electron"
import type { Extension } from "@shared/extension"
import { BrowserService } from "./browser-service"
import { registerBrowserIpc } from "./ipc"
import { createBrowserToolkit } from "./tools"
import type { SessionResource } from "../../../main/utils/session-resource"

interface MainWindowService {
  get(): BrowserWindow
}

const extension: Extension = {
  activate(app, context) {
    let service: BrowserService | null = null
    const getService = (): BrowserService => {
      if (service) return service
      const mainWindow = app.get<MainWindowService>("service", "main-window")
      if (!mainWindow) throw new Error("main-window service is not registered")
      service = new BrowserService(mainWindow.get())
      return service
    }

    const unregisterIpc = registerBrowserIpc(getService)
    app.register("tool", "browser", createBrowserToolkit(getService))
    app.register("session-resource", "browser", {
      async destroySession(sessionId: string) {
        await service?.destroySession(sessionId)
      }
    } satisfies SessionResource)
    context.subscriptions.push({
      dispose: async () => {
        unregisterIpc()
        await service?.destroy()
      }
    })
  }
}

export default extension
