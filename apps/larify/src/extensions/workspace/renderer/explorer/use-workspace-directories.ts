import { useCallback, useEffect, useRef, useState } from 'react'
import type { DataNode } from 'rc-tree/lib/interface'
import { workspaceClient } from '../workspace-client'
import { isDirectoryLoaded, mergeLoadedChildren, updateDirectory } from './workspace-tree-state'

export function useWorkspaceDirectories(resourceId: number): {
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
  const active = state.resourceId === resourceId
  const entries = active ? state.entries : []
  const root = active ? state.root : null
  const entriesRef = useRef(entries)
  const rootRef = useRef(root)
  const lifecycle = useRef(0)
  const requests = useRef(new Map<string, number>())

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
    entriesRef.current = []
    rootRef.current = null

    const initialLoad = load('').catch((error) => {
      if (lifecycle.current === current) console.error('[workspace:list]', error)
    })

    const unsubscribe = workspaceClient.onDidChange(resourceId, (directory) => {
      void initialLoad
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
  }, [load, resourceId])

  const isLoaded = useCallback(
    (directory: string): boolean => isDirectoryLoaded(entriesRef.current, directory),
    []
  )

  return { entries, isLoaded, load, root }
}
