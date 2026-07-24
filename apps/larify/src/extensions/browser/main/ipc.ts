import { ipcMain, type IpcMainInvokeEvent, type Rectangle, type WebContents } from "electron"
import type { BrowserService } from "./browser-service"

export function registerBrowserIpc(getService: () => BrowserService): () => void {
  let bound = false
  let unbindChange: (() => void) | null = null
  const subscribers = new Set<WebContents>()
  const subscribe = (event: IpcMainInvokeEvent): void => {
    subscribers.add(event.sender)
  }
  const service = (): BrowserService => {
    const browser = getService()
    if (!bound) {
      unbindChange = browser.bindChange(sendState)
      bound = true
    }
    return browser
  }

  const sendState = (sessionId: string, state: unknown): void => {
    for (const sender of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        continue
      }
      try {
        sender.send("browser:state", { sessionId, state })
      } catch {
        subscribers.delete(sender)
      }
    }
  }

  const handlers = {
    "browser:getState": (event: IpcMainInvokeEvent, sessionId: string) => {
      subscribe(event)
      return service().state(sessionId)
    },
    "browser:create": (event: IpcMainInvokeEvent, sessionId: string, url?: string) => {
      subscribe(event)
      return service().createTab(sessionId, url)
    },
    "browser:ensureTab": (_event: IpcMainInvokeEvent, sessionId: string) =>
      service().ensureTab(sessionId),
    "browser:setActive": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      service().setActive(sessionId, id),
    "browser:reorder": (_event: IpcMainInvokeEvent, sessionId: string, id: number, toIndex: number) =>
      service().reorder(sessionId, id, toIndex),
    "browser:close": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      service().close(sessionId, id),
    "browser:navigate": (_event: IpcMainInvokeEvent, sessionId: string, id: number, url: string) =>
      service().navigate(sessionId, id, url),
    "browser:back": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      service().goBack(sessionId, id),
    "browser:forward": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      service().goForward(sessionId, id),
    "browser:reload": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      service().reload(sessionId, id),
    "browser:setBounds": (_event: IpcMainInvokeEvent, sessionId: string, bounds: Rectangle) =>
      service().setBounds(sessionId, bounds),
    "browser:setVisible": (_event: IpcMainInvokeEvent, sessionId: string, visible: boolean) =>
      service().setVisible(sessionId, visible),
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  return () => {
    unbindChange?.()
    unbindChange = null
    subscribers.clear()
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
