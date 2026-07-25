import type { WorkspaceEntry } from '../shared/types'

export const workspaceClient = {
  open: (root: string) => window.bridge.invoke('workspace:open', root) as Promise<string>,

  readDirectory: (directory?: string) =>
    window.bridge.invoke('workspace:list', directory) as Promise<WorkspaceEntry[]>,

  stat: (path: string) =>
    window.bridge.invoke('workspace:stat', path) as Promise<{
      directory: boolean
      ctime: number
      mtime: number
      size: number
    }>,

  readFile: (path: string) =>
    window.bridge.invoke('workspace:read', path) as Promise<Uint8Array>,

  writeFile: (path: string, content: Uint8Array) =>
    window.bridge.invoke('workspace:write', path, content) as Promise<void>,

  onDidChange: (listener: (event: string, path: string) => void) =>
    window.bridge.on('workspace:change', (event, path) =>
      listener(event as string, path as string)
    )
}
