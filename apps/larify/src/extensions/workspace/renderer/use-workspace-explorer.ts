import { useCallback, useEffect, useState } from 'react'
import type { EmitArgsWithName } from 'chokidar'
import { monacoReady } from './monaco'
import { workspaceClient } from './workspace-client'
import type { TreeEntry } from './workspace-tree'

const toTreeEntries = (
  entries: Awaited<ReturnType<typeof workspaceClient.readDirectory>>,
  previous: TreeEntry[] = []
): TreeEntry[] => {
  const previousByPath = new Map(previous.map((entry) => [entry.path, entry]))
  return entries.map((entry) => {
    const existing = previousByPath.get(entry.path)
    return {
      ...entry,
      children:
        entry.kind === 'directory'
          ? existing?.children ?? []
          : undefined,
      loaded: entry.kind === 'file' || existing?.loaded === true
    }
  })
}

const parentPath = (path: string): string => {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator < 0 ? '' : path.slice(0, separator)
}

const replaceDirectoryChildren = (
  entries: TreeEntry[],
  directory: string,
  children: TreeEntry[]
): TreeEntry[] =>
  entries.map((entry) => {
    if (entry.path === directory) {
      return { ...entry, children: toTreeEntries(children, entry.children), loaded: true }
    }
    return entry.children
      ? { ...entry, children: replaceDirectoryChildren(entry.children, directory, children) }
      : entry
  })

export function useWorkspaceExplorer(): {
  entries: TreeEntry[]
  loadDirectory(directory: TreeEntry): Promise<void>
  openFolder(): Promise<void>
  root: string | null
} {
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<TreeEntry[]>([])

  const openFolder = useCallback(async (): Promise<void> => {
    const [selected] = (await window.bridge.invoke('dialog:pick-directories')) as string[]
    if (!selected) return
    await monacoReady
    const openedRoot = await workspaceClient.open(selected)
    setRoot(openedRoot)
    setEntries(toTreeEntries(await workspaceClient.readDirectory()))
  }, [])

  const loadDirectory = useCallback(async (directory: TreeEntry): Promise<void> => {
    const children = toTreeEntries(await workspaceClient.readDirectory(directory.path))
    setEntries((current) => replaceDirectoryChildren(current, directory.path, children))
  }, [])

  useEffect(() => {
    if (!root) return
    const unsubscribe = workspaceClient.onDidChange((value, changedPath) => {
      const event = value as EmitArgsWithName[0]
      if (!['add', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return

      const directory = parentPath(changedPath)
      void workspaceClient.readDirectory(directory).then((children) => {
        setEntries((current) =>
          directory === root
            ? toTreeEntries(children, current)
            : replaceDirectoryChildren(current, directory, toTreeEntries(children))
        )
      })
    })
    return () => {
      unsubscribe()
    }
  }, [root])

  return { entries, loadDirectory, openFolder, root }
}
