import { useEffect, useMemo, useState } from 'react'
import type { FileStatusResult } from 'simple-git'
import { createGitStatusColors } from './git-status'
import { gitClient } from '../git-client'
import { workspaceClient } from '../workspace-client'

const REFRESH_DELAY = 400

interface GitDecorationsOptions {
  includeIgnored?: boolean
}

export function useGitDecorations(
  resourceId: number,
  root: string | null,
  { includeIgnored = true }: GitDecorationsOptions = {}
): {
  decorations: Map<string, string>
  error?: string
  loading: boolean
  statuses: FileStatusResult[]
} {
  const [snapshot, setSnapshot] = useState<{
    error?: string
    root: string
    statuses: FileStatusResult[]
  }>({ root: '', statuses: [] })

  useEffect(() => {
    if (!root) return

    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    let running = false
    let queued = false

    const scheduleRefresh = (): void => {
      clearTimeout(timer)
      timer = setTimeout(refresh, REFRESH_DELAY)
    }

    const refresh = (): void => {
      if (running) {
        queued = true
        return
      }
      running = true
      void gitClient
        .status(root, includeIgnored)
        .then((statuses) => {
          if (cancelled) return
          setSnapshot({ root, statuses })
        })
        .catch((error) => {
          if (cancelled) return
          setSnapshot({
            error: error instanceof Error ? error.message : String(error),
            root,
            statuses: []
          })
          console.error('[workspace:git-status]', error)
        })
        .finally(() => {
          running = false
          if (!cancelled && queued) {
            queued = false
            scheduleRefresh()
          }
        })
    }

    refresh()
    const unsubscribe = workspaceClient.onDidChange(resourceId, scheduleRefresh)

    return () => {
      cancelled = true
      queued = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [includeIgnored, resourceId, root])

  return useMemo(() => {
    const current = root && snapshot.root === root
    return {
      decorations: current
        ? createGitStatusColors(root, snapshot.statuses)
        : new Map<string, string>(),
      error: current ? snapshot.error : undefined,
      loading: Boolean(root && !current),
      statuses: current ? snapshot.statuses : []
    }
  }, [root, snapshot])
}
