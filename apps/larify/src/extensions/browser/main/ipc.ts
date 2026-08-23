import {
  ipcMain,
  session,
  webContents,
  type IpcMainInvokeEvent,
  type WebContents
} from "electron"
import type { BrowserService } from "./browser-service"
import { BROWSER_PARTITION, type BrowserState } from "../shared/types"

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
    "browser:openUrl": (_event: IpcMainInvokeEvent, sessionId: string, url: string) =>
      browser.openUrl(sessionId, url),
    "browser:navigate": (_event: IpcMainInvokeEvent, sessionId: string, id: number, url: string) =>
      browser.navigate(sessionId, id, url),
    "browser:back": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.goBack(sessionId, id),
    "browser:forward": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.goForward(sessionId, id),
    "browser:reload": (_event: IpcMainInvokeEvent, sessionId: string, id: number) =>
      browser.reload(sessionId, id),
    "browser:attach": (
      event: IpcMainInvokeEvent,
      sessionId: string,
      id: number,
      webContentsId: number
    ) => {
      const guest = webContents.fromId(webContentsId)
      if (
        !guest ||
        guest.hostWebContents !== event.sender ||
        guest.getType() !== "webview" ||
        guest.session !== session.fromPartition(BROWSER_PARTITION)
      ) {
        throw new Error("browser guest WebContents is unavailable")
      }
      browser.attach(sessionId, id, guest)
    }
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  return () => {
    unbindChange()
    for (const [sender, onDestroyed] of subscribers) sender.off("destroyed", onDestroyed)
    subscribers.clear()
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
