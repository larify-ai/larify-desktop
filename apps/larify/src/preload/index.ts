import { contextBridge, ipcRenderer, webUtils } from 'electron'

const bridge = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  sendSync: (channel: string, ...args: unknown[]) => ipcRenderer.sendSync(channel, ...args),
  on: (channel: string, listener: (...args: unknown[]) => void) => {
    const handler = (_event: unknown, ...args: unknown[]): void => listener(...args)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const fs = {
  getPathForFile: (file: File) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('bridge', bridge)
contextBridge.exposeInMainWorld('fs', fs)

export type Bridge = typeof bridge
export type FileSystem = typeof fs
