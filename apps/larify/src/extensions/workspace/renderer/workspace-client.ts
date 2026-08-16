import type { DirectoryListing, FileDescriptor } from '../shared/types'

export const workspaceClient = {
  inspectFile: (resourceId: number, file: string) =>
    window.bridge.invoke('workspace:inspect', resourceId, file) as Promise<FileDescriptor>,
  readDirectory: (resourceId: number, directory?: string) =>
    window.bridge.invoke('workspace:list', resourceId, directory) as Promise<DirectoryListing>,
  readFile: (resourceId: number, file: string) =>
    window.bridge.invoke('workspace:read', resourceId, file) as Promise<string>,
  readAsset: (resourceId: number, file: string) =>
    window.bridge.invoke('workspace:read-asset', resourceId, file) as Promise<{
      bytes: Uint8Array
      mime: string
    }>,
  reveal: (resourceId: number, file: string) =>
    window.bridge.invoke('workspace:reveal', resourceId, file) as Promise<string[]>,
  onDidChange: (resourceId: number, listener: (directory: string, changedPath: string) => void) =>
    window.bridge.on('workspace:change', (changedResourceId, directory, changedPath) => {
      if (changedResourceId === resourceId) {
        listener(directory as string, changedPath as string)
      }
    })
}
