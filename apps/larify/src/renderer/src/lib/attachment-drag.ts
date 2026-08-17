export const workspaceEntryDragType = 'application/x-larify-workspace-entry'

export interface WorkspaceDragData {
  directory: boolean
  name: string
  path: string
}

export const createWorkspaceDragData = (data: WorkspaceDragData): string => JSON.stringify(data)

export const readWorkspaceDragData = (value: string): WorkspaceDragData | undefined => {
  if (!value) return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const data = parsed as Partial<WorkspaceDragData>
    if (
      typeof data.path !== 'string' ||
      data.path.length === 0 ||
      typeof data.name !== 'string' ||
      data.name.length === 0 ||
      typeof data.directory !== 'boolean'
    ) {
      return undefined
    }
    return { directory: data.directory, name: data.name, path: data.path }
  } catch {
    return undefined
  }
}
