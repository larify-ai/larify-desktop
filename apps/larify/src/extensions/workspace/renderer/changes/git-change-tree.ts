import type { FileStatusResult } from 'simple-git'
import type { DataNode } from 'rc-tree/lib/interface'
import posixPath from 'path-unified/posix'
import win32Path from 'path-unified/win32'

export const isGitChange = (status: FileStatusResult): boolean => {
  const pair = `${status.index}${status.working_dir}`
  return pair !== '  ' && pair !== '!!'
}

export const createPathChangeTree = (root: string, paths: string[]): DataNode[] => {
  const pathApi = /^(?:[a-z]:[\\/]|\\\\)/i.test(root) ? win32Path : posixPath
  const normalizedRoot = pathApi.normalize(root)
  const rootEntry: DataNode = {
    children: [],
    key: normalizedRoot,
    title: pathApi.basename(normalizedRoot) || normalizedRoot
  }
  const entries = new Map<string, DataNode>([[normalizedRoot, rootEntry]])

  for (const candidate of paths) {
    const file = pathApi.resolve(normalizedRoot, candidate)
    const relativePath = pathApi.relative(normalizedRoot, file)
    if (
      !relativePath ||
      relativePath === '..' ||
      pathApi.isAbsolute(relativePath) ||
      relativePath.startsWith(`..${pathApi.sep}`)
    ) {
      continue
    }
    const segments = relativePath.split(pathApi.sep)
    let parent = rootEntry
    let current = normalizedRoot

    segments.forEach((segment, index) => {
      current = pathApi.join(current, segment)
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
