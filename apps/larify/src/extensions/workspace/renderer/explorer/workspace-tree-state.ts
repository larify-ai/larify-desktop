import type { DataNode } from 'rc-tree/lib/interface'

export interface CompactDirectoryNode extends DataNode {
  directoryPath?: string
  directoryPaths?: string[]
}

const compactDirectory = (entry: DataNode): CompactDirectoryNode => {
  let current: CompactDirectoryNode = {
    ...entry,
    children: entry.children?.map(compactDirectory)
  }
  const names = [String(entry.title ?? '')]

  while (current.children?.length === 1 && !current.children[0].isLeaf) {
    const child = current.children[0] as CompactDirectoryNode
    names.push(String(child.title ?? ''))
    current = {
      ...child,
      directoryPath: child.directoryPath ?? String(child.key),
      directoryPaths: [String(entry.key), ...(child.directoryPaths ?? [String(child.key)])],
      key: entry.key,
      title: names.join(' / ')
    }
  }

  return current
}

export const compactDirectoryTree = (entries: DataNode[]): CompactDirectoryNode[] =>
  entries.map((entry) => ({
    ...entry,
    children: entry.children?.map(compactDirectory)
  }))

export const mergeLoadedChildren = (next: DataNode[], previous: DataNode[]): DataNode[] => {
  const previousEntries = new Map(previous.map((entry) => [String(entry.key), entry]))
  return next.map((entry) => {
    if (entry.isLeaf || entry.children !== undefined) return entry
    const previousEntry = previousEntries.get(String(entry.key))
    const children = previousEntry?.isLeaf ? undefined : previousEntry?.children
    return children === undefined ? entry : { ...entry, children }
  })
}

export const updateDirectory = (
  entries: DataNode[],
  directory: string,
  children: DataNode[]
): DataNode[] => {
  let changed = false
  const next = entries.map((entry) => {
    if (String(entry.key) === directory) {
      changed = true
      return { ...entry, children: mergeLoadedChildren(children, entry.children ?? []) }
    }
    if (!entry.children) return entry
    const nextChildren = updateDirectory(entry.children, directory, children)
    if (nextChildren === entry.children) return entry
    changed = true
    return { ...entry, children: nextChildren }
  })
  return changed ? next : entries
}

export const isDirectoryLoaded = (entries: DataNode[], directory: string): boolean =>
  entries.some(
    (entry) =>
      (String(entry.key) === directory && entry.children !== undefined) ||
      (entry.children ? isDirectoryLoaded(entry.children, directory) : false)
  )

export const initialExpandedKeys = (entries: DataNode[], changesOnly: boolean): string[] => {
  if (!changesOnly) {
    return entries.filter((entry) => !entry.isLeaf).map((entry) => String(entry.key))
  }
  const keys: string[] = []

  const visit = (entry: DataNode): void => {
    if (entry.isLeaf) return
    keys.push(String(entry.key))
    entry.children?.forEach(visit)
  }

  entries.forEach(visit)
  return keys
}
