import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmitArgsWithName } from 'chokidar'
import { useAgentSessionCwd } from '@renderer/lib/agent-session'
import { workspaceClient } from './workspace-client'
import type { TreeEntry } from './workspace-tree'

const pathKey = (path: string): string => (path.includes('\\') ? path.toLowerCase() : path)
const samePath = (left: string, right: string): boolean => pathKey(left) === pathKey(right)

const toTreeEntries = (
  entries: Awaited<ReturnType<typeof workspaceClient.readDirectory>>,
  previous: TreeEntry[] = []
): TreeEntry[] => {
  const previousByPath = new Map(previous.map((entry) => [pathKey(entry.path), entry]))
  return entries.map((entry) => {
    const existing = previousByPath.get(pathKey(entry.path))
    return {
      ...entry,
      children: entry.kind === 'directory' ? (existing?.children ?? []) : undefined,
      loaded: entry.kind === 'file' || existing?.loaded === true
    }
  })
}

const parentPath = (path: string): string => {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator < 0 ? '' : path.slice(0, separator)
}

const forgetDirectory = (directories: Set<string>, directory: string): void => {
  const key = pathKey(directory)
  const prefix = `${key}${directory.includes('\\') ? '\\' : '/'}`
  for (const loaded of directories) {
    if (loaded === key || loaded.startsWith(prefix)) directories.delete(loaded)
  }
}

const replaceDirectoryChildren = (
  entries: TreeEntry[],
  directory: string,
  children: TreeEntry[]
): TreeEntry[] =>
  entries.map((entry) => {
    if (samePath(entry.path, directory)) {
      return { ...entry, children: toTreeEntries(children, entry.children), loaded: true }
    }
    return entry.children
      ? { ...entry, children: replaceDirectoryChildren(entry.children, directory, children) }
      : entry
  })

export function useWorkspaceExplorer(): {
  entries: TreeEntry[]
  loadDirectory(directory: TreeEntry): Promise<void>
  revealFile(file: string): Promise<void>
  root: string | null
} {
  const cwd = useAgentSessionCwd()
  const [workspace, setWorkspace] = useState<{
    cwd: string
    entries: TreeEntry[]
    root: string
  } | null>(null)
  const activeWorkspace = workspace && cwd && samePath(workspace.cwd, cwd) ? workspace : null
  const root = activeWorkspace?.root ?? null
  const entries = activeWorkspace?.entries ?? []
  const openQueue = useRef(Promise.resolve())
  const loadedDirectories = useRef(new Set<string>())
  const revealRevision = useRef(0)
  const rootRevision = useRef(0)

  useEffect(() => {
    const revision = ++rootRevision.current
    ++revealRevision.current
    loadedDirectories.current.clear()
    if (!cwd) return
    let cancelled = false
    const open = openQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return
        const start = `larify:workspace-open:start:${crypto.randomUUID()}`
        performance.mark(start)
        try {
          const openedRoot = await workspaceClient.open(cwd)
          const children = await workspaceClient.readDirectory()
          if (cancelled || revision !== rootRevision.current) return
          setWorkspace({ cwd, entries: toTreeEntries(children), root: openedRoot })
          loadedDirectories.current.add(pathKey(openedRoot))
        } finally {
          performance.measure('larify:workspace-open', start)
          performance.clearMarks(start)
        }
      })
    openQueue.current = open
    void open.catch((error) => {
      if (cancelled) return
      setWorkspace(null)
      console.error('[workspace:open]', error)
    })
    return () => {
      cancelled = true
    }
  }, [cwd])

  const loadDirectory = useCallback(
    async (directory: TreeEntry): Promise<void> => {
      const revision = rootRevision.current
      const start = `larify:directory-load:start:${crypto.randomUUID()}`
      performance.mark(start)
      try {
        const children = toTreeEntries(await workspaceClient.readDirectory(directory.path))
        if (revision !== rootRevision.current) return
        loadedDirectories.current.add(pathKey(directory.path))
        setWorkspace((current) =>
          current && cwd && samePath(current.cwd, cwd)
            ? {
                ...current,
                entries: replaceDirectoryChildren(current.entries, directory.path, children)
              }
            : current
        )
      } finally {
        performance.measure('larify:directory-load', start)
        performance.clearMarks(start)
      }
    },
    [cwd]
  )

  const revealFile = useCallback(
    async (file: string): Promise<void> => {
      if (!root) return
      const revision = ++revealRevision.current
      const directories: string[] = []
      let directory = parentPath(file)
      while (directory) {
        directories.unshift(directory)
        if (samePath(directory, root)) break
        directory = parentPath(directory)
      }
      if (!directories[0] || !samePath(directories[0], root)) return

      for (const current of directories) {
        if (loadedDirectories.current.has(pathKey(current))) continue
        const children = toTreeEntries(await workspaceClient.readDirectory(current))
        if (revision !== revealRevision.current) return
        loadedDirectories.current.add(pathKey(current))
        setWorkspace((workspace) =>
          workspace && cwd && samePath(workspace.cwd, cwd)
            ? {
                ...workspace,
                entries: samePath(current, root)
                  ? toTreeEntries(children, workspace.entries)
                  : replaceDirectoryChildren(workspace.entries, current, children)
              }
            : workspace
        )
      }
    },
    [cwd, root]
  )

  useEffect(() => {
    if (!root) return
    const revision = rootRevision.current
    const unsubscribe = workspaceClient.onDidChange((value, changedPath) => {
      const event = value as EmitArgsWithName[0]
      if (!['add', 'unlink', 'addDir', 'unlinkDir'].includes(event)) return
      if (event === 'addDir' || event === 'unlinkDir') {
        forgetDirectory(loadedDirectories.current, changedPath)
      }

      const directory = parentPath(changedPath)
      void workspaceClient
        .readDirectory(directory)
        .then((children) => {
          if (revision !== rootRevision.current) return
          setWorkspace((current) =>
            current && cwd && samePath(current.cwd, cwd)
              ? {
                  ...current,
                  entries: samePath(directory, root)
                    ? toTreeEntries(children, current.entries)
                    : replaceDirectoryChildren(current.entries, directory, toTreeEntries(children))
                }
              : current
          )
        })
        .catch((error) => {
          if (revision === rootRevision.current) {
            console.error('[workspace:refresh-directory]', error)
          }
        })
    })
    return () => {
      unsubscribe()
    }
  }, [cwd, root])

  return { entries, loadDirectory, revealFile, root }
}
