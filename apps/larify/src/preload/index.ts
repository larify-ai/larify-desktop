import { contextBridge, ipcRenderer, webUtils } from "electron"
import { statSync } from "fs"

const bridge = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  isDirectoryPath: (path: string) => {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const handler = (_e: unknown, ...a: unknown[]): void => cb(...a)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

contextBridge.exposeInMainWorld("bridge", bridge)

export type Bridge = typeof bridge
