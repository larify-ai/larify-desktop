import { useEffect, useMemo, useState } from 'react'
import type { FileStatusResult } from 'simple-git'
import { createGitStatusColors } from './git-status'
import { gitClient } from '../git-client'
import { workspaceClient } from '../workspace-client'

const REFRESH_DELAY = 400

export function useGitDecorations(
  resourceId: number,
  root: string | null
): {
  decorations: Map<string, string>
  statuses: FileStatusResult[]
} {
  const [snapshot, setSnapshot] = useState<{
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
      const start = `larify:git-status:start:${crypto.randomUUID()}`
      performance.mark(start)
      void gitClient
        .status(root)
        .then((statuses) => {
          if (cancelled) return
          setSnapshot({ root, statuses })
        })
        .catch((error) => {
          if (cancelled) return
          setSnapshot({ root, statuses: [] })
          console.error('[workspace:git-status]', error)
        })
        .finally(() => {
          performance.measure('larify:git-status', start)
          performance.clearMarks(start)
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
  }, [resourceId, root])

  return useMemo(() => {
    const current = root && snapshot.root === root
    return {
      decorations: current
        ? createGitStatusColors(root, snapshot.statuses)
        : new Map<string, string>(),
      statuses: current ? snapshot.statuses : []
    }
  }, [root, snapshot])
}
