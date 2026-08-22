import {
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents
} from "electron"
import type { BrowserService } from "./browser-service"
import type { BrowserState } from "../shared/types"

export function registerBrowserIpc(browser: BrowserService): () => void {
  const subscribers = new Map<WebContents, () => void>()
  const subscribe = (event: IpcMainInvokeEvent): void => {
    const sender = event.sender
    if (subscribers.has(sender)) return
    const onDestroyed = (): void => {
      subscribers.delete(sender)
    }
    subscribers.set(sender, onDestroyed)
    sender.once("destroyed", onDestroyed)
  }
  const sendState = (sessionId: string, state: BrowserState): void => {
    for (const [sender, onDestroyed] of subscribers) {
      if (sender.isDestroyed()) {
        subscribers.delete(sender)
        sender.off("destroyed", onDestroyed)
        continue
      }
      try {
        sender.send("browser:state", { sessionId, state })
      } catch {
        subscribers.delete(sender)
        sender.off("destroyed", onDestroyed)
      }
    }
  }
  const unbindChange = browser.bindChange(sendState)

  const handlers = {
    "browser:getState": (event: IpcMainInvokeEvent, sessionId: string, id: number) => {
      subscribe(event)
      return browser.tab(sessionId, id)?.state() ?? null
    },
    "browser:navigate": (_event: IpcMainInvokeEvent, sessionId: string, id: number, url: string) =>
      browser.navigate(sessionId, id, url),
    "browser:back": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.goBack(sessionId, id),
    "browser:forward": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.goForward(sessionId, id),
    "browser:reload": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.reload(sessionId, id),
    "browser:setVisible": (
      _event: IpcMainInvokeEvent,
      sessionId: string,
      id: number,
      visible: boolean
    ) => browser.setVisible(sessionId, id, visible)
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  const setBoundsSync = (
    event: IpcMainEvent,
    sessionId: string,
    id: number,
    bounds: Rectangle,
    live = false,
    activate = false
  ): void => {
    try {
      event.returnValue = browser.setBounds(sessionId, id, bounds, live, activate) !== false
    } catch (error) {
      console.error("[browser] Failed to update bounds:", error)
      event.returnValue = false
    }
  }
  ipcMain.on("browser:setBoundsSync", setBoundsSync)

  return () => {
    unbindChange()
    for (const [sender, onDestroyed] of subscribers) sender.off("destroyed", onDestroyed)
    subscribers.clear()
    ipcMain.removeListener("browser:setBoundsSync", setBoundsSync)
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
