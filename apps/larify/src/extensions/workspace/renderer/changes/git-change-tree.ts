import type { FileStatusResult } from 'simple-git'
import type { DataNode } from 'rc-tree/lib/interface'
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'path-unified'

export const isGitChange = (status: FileStatusResult): boolean => {
  const pair = `${status.index}${status.working_dir}`
  return pair !== '  ' && pair !== '!!'
}

export const createPathChangeTree = (root: string, paths: string[]): DataNode[] => {
  const normalizedRoot = normalize(root)
  const rootEntry: DataNode = {
    children: [],
    key: normalizedRoot,
    title: basename(normalizedRoot) || normalizedRoot
  }
  const entries = new Map<string, DataNode>([[normalizedRoot, rootEntry]])

  for (const candidate of paths) {
    const file = resolve(normalizedRoot, candidate)
    const relativePath = relative(normalizedRoot, file)
    if (
      !relativePath ||
      relativePath === '..' ||
      isAbsolute(relativePath) ||
      relativePath.startsWith(`..${sep}`)
    ) {
      continue
    }
    const segments = relativePath.split(sep)
    let parent = rootEntry
    let current = normalizedRoot

    segments.forEach((segment, index) => {
      current = join(current, segment)
      const isLeaf = index === segments.length - 1
      let entry = entries.get(current)
      if (!entry) {
        entry = {
          ...(isLeaf ? { isLeaf: true } : { children: [] }),
          key: current,
          title: segment
        }
        entries.set(current, entry)
        parent.children?.push(entry)
      }
      parent = entry
    })
  }

  return [rootEntry]
}

export const createGitChangeTree = (root: string, statuses: FileStatusResult[]): DataNode[] =>
  createPathChangeTree(
    root,
    statuses.filter(isGitChange).map((status) => status.path)
  )
