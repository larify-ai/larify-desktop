import type { WorkspaceEntry, WorkspaceGitStatus } from '../shared/types'

const READ_CHUNK_SIZE = 256 * 1024

const readFile = async (path: string): Promise<Uint8Array | null> => {
  const handle = await workspaceClient.openFile(path)
  if (handle === null) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await workspaceClient.readFileChunk(handle, size, READ_CHUNK_SIZE)
      if (chunk.byteLength === 0) break
      chunks.push(chunk)
      size += chunk.byteLength
    }
  } finally {
    await workspaceClient.closeFile(handle)
  }
  const content = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    content.set(chunk, offset)
    offset += chunk.byteLength
  }
  return content
}

export const workspaceClient = {
  open: (root: string) => window.bridge.invoke('workspace:open', root) as Promise<string>,

  readDirectory: (directory?: string) =>
    window.bridge.invoke('workspace:list', directory) as Promise<WorkspaceEntry[]>,

  gitStatuses: () => window.bridge.invoke('workspace:git-status') as Promise<WorkspaceGitStatus>,

  stat: (path: string) =>
    window.bridge.invoke('workspace:stat', path) as Promise<{
      directory: boolean
      ctime: number
      mtime: number
      size: number
    } | null>,

  readFile,

  openFile: (path: string) =>
    window.bridge.invoke('workspace:file-open', path) as Promise<number | null>,

  allowFile: (path: string) =>
    window.bridge.invoke('workspace:file-allow', path) as Promise<string>,

  readFileChunk: (handle: number, position: number, length: number) =>
    window.bridge.invoke('workspace:file-read', handle, position, length) as Promise<Uint8Array>,

  closeFile: (handle: number) =>
    window.bridge.invoke('workspace:file-close', handle) as Promise<void>,

  writeFile: (path: string, content: Uint8Array) =>
    window.bridge.invoke('workspace:write', path, content) as Promise<void>,

  onDidChange: (listener: (event: string, path: string) => void) =>
    window.bridge.on('workspace:change', (event, path) => listener(event as string, path as string))
}
