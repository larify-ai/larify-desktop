import posixPath from 'path-unified/posix'
import win32Path from 'path-unified/win32'

export interface ChangesNavigationRequest {
  path: string
  resourceId: number
}

export const CHANGES_NAVIGATION_EVENT = 'larify:changes-navigation'

const pending = new Map<number, ChangesNavigationRequest>()

const pathForRoot = (root: string) =>
  /^(?:[a-z]:[\\/]|\\\\)/i.test(root) ? win32Path : posixPath

export const resolveChangesPath = (root: string, file: string): string =>
  pathForRoot(root).resolve(root, file)

export function sameChangesPath(root: string, left: string, right: string): boolean {
  const path = pathForRoot(root)
  return path.relative(path.resolve(root, left), path.resolve(root, right)) === ''
}

export function changesRootForFile(root: string, file: string): string {
  const path = pathForRoot(root)
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
