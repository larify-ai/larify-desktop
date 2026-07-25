import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmitArgsWithName } from 'chokidar'
import { useAgentSessionCwd } from '@renderer/lib/agent-session'
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
  root: string | null
} {
  const cwd = useAgentSessionCwd()
  const [root, setRoot] = useState<string | null>(null)
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const openQueue = useRef(Promise.resolve())

  useEffect(() => {
    if (!cwd) return
    let cancelled = false
    const open = openQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return
        const openedRoot = await workspaceClient.open(cwd)
        const children = await workspaceClient.readDirectory()
        if (cancelled) return
        setRoot(openedRoot)
        setEntries(toTreeEntries(children))
      })
    openQueue.current = open
    void open.catch((error) => {
      if (cancelled) return
      setRoot(null)
      setEntries([])
      console.error('[workspace:open]', error)
    })
    return () => {
      cancelled = true
    }
  }, [cwd])

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

  return { entries, loadDirectory, root }
}
