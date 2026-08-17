import type { FileStatusResult } from 'simple-git'

export const gitClient = {
  original: (root: string, file: string) =>
    window.bridge.invoke('git:original', root, file) as Promise<Uint8Array | null>,
  status: (root: string, includeIgnored = true) =>
    window.bridge.invoke('git:status', root, includeIgnored) as Promise<FileStatusResult[]>
}
