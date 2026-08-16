import type { FileStatusResult } from 'simple-git'

export const gitClient = {
  status: (root: string) => window.bridge.invoke('git:status', root) as Promise<FileStatusResult[]>
}
