import { changesRootForFile } from './changes/changes-navigation'

export interface WorkspaceNavigationRequest {
  /** 目标文件的绝对路径 */
  path: string
  kind?: 'file' | 'directory'
  hash?: string
  resourceId: number
}

/** 外层打开 workspace 资源后，用于请求定位到指定文件的浏览器事件。 */
export const WORKSPACE_NAVIGATION_EVENT = 'larify:workspace-navigation'

const pending = new Map<number, WorkspaceNavigationRequest>()

/** 决定展示根：目标在 base(root) 内则用 base，否则退到目标所在目录。 */
export function workspaceRootForFile(base: string, file: string): string {
  return changesRootForFile(base, file)
}

export function takeWorkspaceNavigation(resourceId: number): WorkspaceNavigationRequest | null {
  const request = pending.get(resourceId) ?? null
  pending.delete(resourceId)
  return request
}

export function requestWorkspaceNavigation(request: WorkspaceNavigationRequest): void {
  pending.set(request.resourceId, request)
  window.dispatchEvent(
    new CustomEvent<WorkspaceNavigationRequest>(WORKSPACE_NAVIGATION_EVENT, { detail: request })
  )
}
