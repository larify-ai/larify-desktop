import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataNode } from 'rc-tree/lib/interface'
import { workspaceClient } from '../workspace-client'
import { isDirectoryLoaded, mergeLoadedChildren, updateDirectory } from './workspace-tree-state'

export function useWorkspaceDirectories(
  resourceId: number,
  active = true
): {
  entries: DataNode[]
  isLoaded(directory: string): boolean
  load(directory: string, signal?: AbortSignal): Promise<DataNode[]>
  root: string | null
} {
  const [state, setState] = useState<{
    entries: DataNode[]
    resourceId: number
    root: string | null
  }>({ entries: [], resourceId, root: null })
  const currentResource = state.resourceId === resourceId
  const entries = currentResource ? state.entries : []
  const root = currentResource ? state.root : null
  const entriesRef = useRef(entries)
  const rootRef = useRef(root)
  const lifecycle = useRef(0)
  const requests = useRef(new Map<string, number>())
  const dirtyDirectories = useRef(new Set<string>())

  const replaceEntries = useCallback(
    (next: DataNode[]): void => {
      entriesRef.current = next
      setState({ entries: next, resourceId, root: rootRef.current })
    },
    [resourceId]
  )

  const load = useCallback(
    async (directory: string, signal?: AbortSignal): Promise<DataNode[]> => {
      if (signal?.aborted) return []
      const currentLifecycle = lifecycle.current
      const target = rootRef.current && directory ? directory : undefined
      const requestKey = target ?? ''
      const request = (requests.current.get(requestKey) ?? 0) + 1
      requests.current.set(requestKey, request)
      const { entries: children, root: nextRoot } = await workspaceClient.readDirectory(
        resourceId,
        target
      )
      if (
        signal?.aborted ||
        lifecycle.current !== currentLifecycle ||
        requests.current.get(requestKey) !== request
      ) {
        return []
      }
      rootRef.current ??= nextRoot
      replaceEntries(
        target === undefined || directory === nextRoot
          ? mergeLoadedChildren(children, entriesRef.current)
          : updateDirectory(entriesRef.current, directory, children)
      )
      return children
    },
    [replaceEntries, resourceId]
  )

  useEffect(() => {
    const current = ++lifecycle.current
    requests.current.clear()
    dirtyDirectories.current.clear()
    entriesRef.current = []
    rootRef.current = null
    return () => {
      lifecycle.current = current + 1
    }
  }, [resourceId])

  useEffect(() => {
    const current = ++lifecycle.current
    requests.current.clear()
    const pendingDirectories = active ? [...dirtyDirectories.current] : []
    if (active) dirtyDirectories.current.clear()

    const initialLoad =
      !active || rootRef.current
        ? Promise.resolve()
        : load('').catch((error) => {
            if (lifecycle.current === current) console.error('[workspace:list]', error)
          })
    const refreshPending = initialLoad.then(async () => {
      for (const directory of pendingDirectories) {
        if (lifecycle.current !== current) return
        try {
          await load(directory)
        } catch (error) {
          dirtyDirectories.current.add(directory)
          if (lifecycle.current === current) console.error('[workspace:refresh]', error)
        }
      }
    })

    const unsubscribe = workspaceClient.onDidChange(resourceId, (directory) => {
      if (!active) {
        dirtyDirectories.current.add(directory)
        return
      }
      void refreshPending
        .then(() => {
          if (lifecycle.current !== current) return
          return load(directory)
        })
        .catch((error) => {
          if (lifecycle.current === current) console.error('[workspace:refresh]', error)
        })
    })
    return () => {
      lifecycle.current = current + 1
      unsubscribe()
    }
  }, [active, load, resourceId])

  const isLoaded = useCallback(
    (directory: string): boolean =>
      directory === rootRef.current || isDirectoryLoaded(entriesRef.current, directory),
    []
  )

  return { entries, isLoaded, load, root }
}
