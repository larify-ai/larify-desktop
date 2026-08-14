import { useCallback, useEffect, useRef } from 'react'
import type { DataNode } from 'rc-tree/lib/interface'
import { workspaceClient } from '../workspace-client'
import { useWorkspaceDirectories } from './use-workspace-directories'

export function useWorkspaceExplorer(resourceId: number): {
  entries: DataNode[]
  loadDirectory(directory: DataNode): Promise<void>
  revealFile(file: string): Promise<string | undefined>
  root: string | null
} {
  const { entries, isLoaded, load, root } = useWorkspaceDirectories(resourceId)
  const revealController = useRef<AbortController>(null)

  useEffect(() => () => revealController.current?.abort(), [resourceId])

  const loadDirectory = useCallback(
    (directory: DataNode): Promise<void> => load(String(directory.key)),
    [load]
  )

  const revealFile = useCallback(
    async (file: string): Promise<string | undefined> => {
      revealController.current?.abort()
      if (!root) return undefined
      const controller = new AbortController()
      revealController.current = controller
      const path = await workspaceClient.reveal(resourceId, file)
      const key = path.at(-1)
      if (!key) return undefined
      for (const directory of path.slice(0, -1)) {
        if (controller.signal.aborted) return undefined
        if (isLoaded(directory)) continue
        await load(directory, controller.signal)
        if (!isLoaded(directory)) return undefined
      }
      return controller.signal.aborted ? undefined : key
    },
    [isLoaded, load, resourceId, root]
  )

  return { entries, loadDirectory, revealFile, root }
}
