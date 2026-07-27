import { useEffect, useMemo, useState } from 'react'
import type { FileStatusResult } from 'simple-git'
import { createGitStatusColors } from './git-status'
import { workspaceClient } from './workspace-client'

const REFRESH_DELAY = 400

export function useGitDecorations(root: string | null): {
  available: boolean
  decorations: Map<string, string>
} {
  const [snapshot, setSnapshot] = useState<{
    available: boolean
    root: string
    statuses: FileStatusResult[]
  }>({ available: true, root: '', statuses: [] })

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
      void workspaceClient
        .gitStatuses()
        .then((result) => {
          if (cancelled) return
          if (result.available) {
            setSnapshot({ available: true, root, statuses: result.statuses })
          } else {
            setSnapshot({ available: false, root, statuses: [] })
            console.warn('[workspace:git-status]', result.message)
          }
        })
        .catch((error) => {
          if (cancelled) return
          setSnapshot({ available: false, root, statuses: [] })
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
    const unsubscribe = workspaceClient.onDidChange(scheduleRefresh)

    return () => {
      cancelled = true
      queued = false
      clearTimeout(timer)
      unsubscribe()
    }
  }, [root])

  return useMemo(() => {
    const current = root && snapshot.root === root
    return {
      available: !current || snapshot.available,
      decorations: current
        ? createGitStatusColors(root, snapshot.statuses)
        : new Map<string, string>()
    }
  }, [root, snapshot])
}
