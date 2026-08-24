import { normalizeGitRoot } from './git-root'

const GIT_STATUS_INVALIDATION_EVENT = 'larify:git-status-invalidate'

export function invalidateGitStatus(root: string): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return
  window.dispatchEvent(
    new CustomEvent(GIT_STATUS_INVALIDATION_EVENT, {
      detail: { root }
    })
  )
}

export function onGitStatusInvalidated(root: string, listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function')
    return () => {}
  const normalizedRoot = normalizeGitRoot(root)
  const handleInvalidation = (event: Event): void => {
    const changedRoot = (event as CustomEvent<{ root?: unknown }>).detail?.root
    if (typeof changedRoot === 'string' && normalizeGitRoot(changedRoot) === normalizedRoot)
      listener()
  }
  window.addEventListener(GIT_STATUS_INVALIDATION_EVENT, handleInvalidation)
  return () => window.removeEventListener(GIT_STATUS_INVALIDATION_EVENT, handleInvalidation)
}
