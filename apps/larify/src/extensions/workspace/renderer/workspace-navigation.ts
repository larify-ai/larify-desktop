import { pathFor } from '@renderer/lib/workspace-link'
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

/**
 * memory/tasks 锚点根：目标位于 `<用户目录>/.larify/memory` 或 `.larify/tasks`
 * 下时，目录树以整个 memory/tasks 为根。渲染层无法访问主进程 homedir，但
 * `.larify/memory|tasks` 是应用固定约定后缀（app-paths 的 larifyPath），可从
 * 路径特征推断——与 pathFor 按盘符/UNC 判别平台同为跨层约定的既定模式。
 * 注意：若未来支持自定义 `.larify` 目录，此特征需与之同步（改为根下发或读取配置）。
 */
const anchorRootPattern = /^(.+[\\/]\.larify[\\/](?:memory|tasks))(?:[\\/]|$)/i

function anchorRootFor(file: string): string | null {
  const path = pathFor(file)
  if (!path.isAbsolute(file)) return null
  const root = anchorRootPattern.exec(file)?.[1]
  return root ? path.normalize(root) : null
}

/**
 * 决定展示根：目标绝对路径位于 memory/tasks 锚点根内 → 锚点根（整个目录树）；
 * 否则沿用 changesRootForFile（目标在 base 内 → base，不在 → 目标所在目录）。
 */
export function workspaceRootForFile(base: string, file: string): string {
  return anchorRootFor(file) ?? changesRootForFile(base, file)
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
