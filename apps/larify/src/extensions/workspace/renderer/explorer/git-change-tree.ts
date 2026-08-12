import type { FileStatusResult } from 'simple-git'
import type { TreeEntry } from './workspace-tree'

const separators = /[\\/]+/
const absolutePath = /^(?:[A-Za-z]:[\\/]|\/)/

const changed = (status: FileStatusResult): boolean => {
  const pair = `${status.index}${status.working_dir}`
  return pair !== '  ' && pair !== '!!'
}

export const createPathChangeTree = (root: string, paths: string[]): TreeEntry[] => {
  const separator = root.includes('\\') ? '\\' : '/'
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const rootPrefix = `${normalizedRoot}${separator}`
  const rootEntry: TreeEntry = {
    children: [],
    kind: 'directory',
    loaded: true,
    name: normalizedRoot.split(separators).at(-1) ?? normalizedRoot,
    path: normalizedRoot,
    root: true
  }
  const directories = new Map<string, TreeEntry>([[normalizedRoot, rootEntry]])

  for (const path of paths) {
    const candidate = path.replaceAll(/[\\/]+/g, separator)
    const absolute = absolutePath.test(candidate)
    const comparableCandidate = candidate.toLocaleLowerCase()
    const comparableRoot = rootPrefix.toLocaleLowerCase()
    if (absolute && !comparableCandidate.startsWith(comparableRoot)) continue
    const file = absolute ? candidate : `${rootPrefix}${candidate}`
    const segments = file.slice(rootPrefix.length).split(separator)
    if (segments.some((segment) => segment === '..' || segment === '')) continue
    let parent = rootEntry
    let current = normalizedRoot

    segments.forEach((segment, index) => {
      current = `${current}${separator}${segment}`
      const fileEntry = index === segments.length - 1
      if (fileEntry) {
        if (!parent.children?.some((entry) => entry.path === current)) {
          parent.children?.push({ kind: 'file', loaded: true, name: segment, path: current })
        }
        return
      }

      let directory = directories.get(current)
      if (!directory) {
        directory = {
          children: [],
          kind: 'directory',
          loaded: true,
          name: segment,
          path: current
        }
        directories.set(current, directory)
        parent.children?.push(directory)
      }
      parent = directory
    })
  }

  return [rootEntry]
}

export const createGitChangeTree = (root: string, statuses: FileStatusResult[]): TreeEntry[] =>
  createPathChangeTree(
    root,
    statuses.filter(changed).map((status) => status.path)
  )
