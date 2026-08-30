import { pathFor } from '@renderer/lib/workspace-link'

export interface ChangesNavigationRequest {
  path: string
  resourceId: number
}

export const CHANGES_NAVIGATION_EVENT = 'larify:changes-navigation'

const pending = new Map<number, ChangesNavigationRequest>()

export const resolveChangesPath = (root: string, file: string): string =>
  pathFor(root).resolve(root, file)

export function sameChangesPath(root: string, left: string, right: string): boolean {
  const path = pathFor(root)
  return path.relative(path.resolve(root, left), path.resolve(root, right)) === ''
}

export function changesRootForFile(root: string, file: string): string {
  // Default-space sessions have no cwd. In that case the target itself must
  // select the path implementation, otherwise a Windows absolute path is
  // interpreted as a POSIX relative path.
  const path = pathFor(root || file)
  const target = path.resolve(root, file)
  const relative = path.relative(root, target)
  const inside =
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  return inside ? root : path.dirname(target)
}

export function peekChangesNavigation(resourceId: number): ChangesNavigationRequest | null {
  return pending.get(resourceId) ?? null
}

export function takeChangesNavigation(resourceId: number): ChangesNavigationRequest | null {
  const request = peekChangesNavigation(resourceId)
  pending.delete(resourceId)
  return request
}

export function requestChangesNavigation(request: ChangesNavigationRequest): void {
  pending.set(request.resourceId, request)
  window.dispatchEvent(
    new CustomEvent<ChangesNavigationRequest>(CHANGES_NAVIGATION_EVENT, { detail: request })
  )
}
