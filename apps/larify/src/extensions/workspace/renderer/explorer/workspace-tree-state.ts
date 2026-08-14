import type { DataNode } from 'rc-tree/lib/interface'

const AUTO_EXPAND_LIMIT = 50

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
  if (!changesOnly) return []
  const keys: string[] = []

  const visit = (entry: DataNode, depth: number): void => {
    if (entry.isLeaf) return
    const open = depth === 0 || (entry.children?.length ?? 0) <= AUTO_EXPAND_LIMIT
    if (!open) return
    keys.push(String(entry.key))
    entry.children?.forEach((child) => visit(child, depth + 1))
  }

  entries.forEach((entry) => visit(entry, 0))
  return keys
}
