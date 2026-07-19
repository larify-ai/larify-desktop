import { BrowserWindow, ipcMain, type IpcMainInvokeEvent, type Rectangle } from "electron"
import type { BrowserTabManager } from "./tab-manager"

export function registerBrowserIpc(getManager: () => BrowserTabManager): () => void {
  let bound = false
  const manager = (): BrowserTabManager => {
    const browser = getManager()
    if (!bound) {
      browser.bindChange(sendState)
      bound = true
    }
    return browser
  }

  const sendState = (): void => {
    const state = manager().state()
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("browser:state", state)
    }
  }

  const handlers = {
    "browser:getState": () => manager().state(),
    "browser:create": (_event: IpcMainInvokeEvent, url?: string) => manager().createTab(url),
    "browser:setActive": (_event: IpcMainInvokeEvent, id: number) => manager().setActive(id),
    "browser:reorder": (_event: IpcMainInvokeEvent, id: number, toIndex: number) =>
      manager().reorder(id, toIndex),
    "browser:close": (_event: IpcMainInvokeEvent, id: number) => manager().close(id),
    "browser:navigate": (_event: IpcMainInvokeEvent, id: number, url: string) =>
      manager().navigate(id, url),
    "browser:back": (_event: IpcMainInvokeEvent, id: number) => manager().goBack(id),
    "browser:forward": (_event: IpcMainInvokeEvent, id: number) => manager().goForward(id),
    "browser:reload": (_event: IpcMainInvokeEvent, id: number) => manager().reload(id),
    "browser:setBounds": (_event: IpcMainInvokeEvent, bounds: Rectangle) => manager().setBounds(bounds),
    "browser:setVisible": (_event: IpcMainInvokeEvent, visible: boolean) => manager().setVisible(visible),
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, handler)
  }

  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
