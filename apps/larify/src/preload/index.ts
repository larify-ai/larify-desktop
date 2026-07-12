import { contextBridge, ipcRenderer } from "electron"

const bridge = {
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const handler = (_e: unknown, ...a: unknown[]): void => cb(...a)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

contextBridge.exposeInMainWorld("bridge", bridge)

export type Bridge = typeof bridge
