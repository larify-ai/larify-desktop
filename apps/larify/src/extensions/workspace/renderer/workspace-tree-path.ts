interface TreePathEntry {
  children?: TreePathEntry[]
  path: string
}

const comparablePath = (path: string): string =>
  /^[a-z]:[\\/]/i.test(path) ? path.replaceAll('\\', '/').toLowerCase() : path

export function findTreeEntryPath(entries: TreePathEntry[], path: string): string | undefined {
  const target = comparablePath(path)
  for (const entry of entries) {
    if (comparablePath(entry.path) === target) return entry.path
    const child = entry.children && findTreeEntryPath(entry.children, path)
    if (child) return child
  }
  return undefined
}
