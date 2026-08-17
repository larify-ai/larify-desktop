import posixPath from 'path-unified/posix'
import win32Path from 'path-unified/win32'

export interface ChangesNavigationRequest {
  path: string
  resourceId: number
}

export const CHANGES_NAVIGATION_EVENT = 'larify:changes-navigation'

const pending = new Map<number, ChangesNavigationRequest>()

export const resolveChangesPath = (root: string, file: string): string =>
  (/^(?:[a-z]:[\\/]|\\\\)/i.test(root) ? win32Path : posixPath).resolve(root, file)

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
