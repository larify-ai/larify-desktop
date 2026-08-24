import { useEffect, useMemo, useState } from 'react'
import type { FileStatusResult } from 'simple-git'
import { createGitStatusColors } from './git-status'
import { gitStatusCoordinator, type GitStatusSnapshot } from './git-status-coordinator'
import { onGitStatusInvalidated } from './git-status-invalidation'
import { workspaceClient } from '../workspace-client'

interface GitDecorationsOptions {
  active?: boolean
  includeIgnored?: boolean
  preloadInactive?: boolean
}

export function useGitDecorations(
  resourceId: number,
  root: string | null,
  { active = true, includeIgnored = true, preloadInactive = false }: GitDecorationsOptions = {}
): {
  decorations: Map<string, string>
  error?: string
  loading: boolean
  statuses: FileStatusResult[]
} {
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot | null>(null)
  const enabled = active || preloadInactive

  useEffect(() => {
    if (!enabled || !root) return

    const update = (): void => setSnapshot(gitStatusCoordinator.snapshot(root, includeIgnored))
    const refresh = (): void => gitStatusCoordinator.refresh(root)
    const unsubscribeState = gitStatusCoordinator.subscribe(root, update)
    const deactivate = gitStatusCoordinator.activate(root, includeIgnored)
    const unsubscribeWorkspace = workspaceClient.onDidChange(resourceId, refresh)
    const unsubscribeInvalidation = onGitStatusInvalidated(root, refresh)
    window.addEventListener('focus', refresh)
    update()

    return () => {
      deactivate()
      unsubscribeState()
      unsubscribeWorkspace()
      unsubscribeInvalidation()
      window.removeEventListener('focus', refresh)
    }
  }, [enabled, includeIgnored, resourceId, root])

  return useMemo(() => {
    const current = root && snapshot?.root === root
    return {
      decorations: current
        ? createGitStatusColors(root, snapshot.statuses)
        : new Map<string, string>(),
      error: current ? snapshot.error : undefined,
      loading: Boolean(root && (!current || snapshot.loading)),
      statuses: current ? snapshot.statuses : []
    }
  }, [root, snapshot])
}
