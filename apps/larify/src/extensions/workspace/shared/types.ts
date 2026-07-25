export interface WorkspaceEntry {
  kind: 'directory' | 'file'
  name: string
  path: string
}
