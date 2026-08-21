import { useCallback, useEffect, useRef } from 'react'
import type { DataNode } from 'rc-tree/lib/interface'
import { workspaceClient } from '../workspace-client'
import { useWorkspaceDirectories } from './use-workspace-directories'

export function useWorkspaceExplorer(resourceId: number): {
  entries: DataNode[]
  loadDirectory(directory: DataNode): Promise<void>
  revealDirectory(directory: string): Promise<string | undefined>
  revealFile(file: string): Promise<string | undefined>
  root: string | null
} {
  const { entries, isLoaded, load, root } = useWorkspaceDirectories(resourceId)
  const revealController = useRef<AbortController>(null)

  useEffect(() => () => revealController.current?.abort(), [resourceId])

  const loadDirectory = useCallback(
    async (directory: DataNode): Promise<void> => {
      let path = String(directory.key)
      while (true) {
        const children = await load(path)
        if (children.length !== 1 || children[0].isLeaf) return
        path = String(children[0].key)
      }
    },
    [load]
  )

  const revealPath = useCallback(
    async (target: string, includeTarget: boolean): Promise<string | undefined> => {
      revealController.current?.abort()
      const controller = new AbortController()
      revealController.current = controller
      if (!root) {
        await load('', controller.signal)
        if (controller.signal.aborted) return undefined
      }
      const path = await workspaceClient.reveal(resourceId, target)
      const key = path.at(-1)
      if (!key) return undefined
      const directories = includeTarget ? path : path.slice(0, -1)
      for (const directory of directories) {
        if (controller.signal.aborted) return undefined
        if (isLoaded(directory)) continue
        await load(directory, controller.signal)
        if (!isLoaded(directory)) return undefined
      }
      return controller.signal.aborted ? undefined : key
    },
    [isLoaded, load, resourceId, root]
  )

  const revealFile = useCallback(
    (file: string): Promise<string | undefined> => revealPath(file, false),
    [revealPath]
  )

  const revealDirectory = useCallback(
    (directory: string): Promise<string | undefined> => revealPath(directory, true),
    [revealPath]
  )

  return { entries, loadDirectory, revealDirectory, revealFile, root }
}
