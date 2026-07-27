import type { FileStatusResult } from 'simple-git'

export interface WorkspaceEntry {
  kind: 'directory' | 'file'
  name: string
  path: string
}

export type WorkspaceGitStatus =
  { available: true; statuses: FileStatusResult[] } | { available: false; message: string }
