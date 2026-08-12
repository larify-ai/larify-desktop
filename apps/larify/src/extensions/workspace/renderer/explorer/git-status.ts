import type { FileStatusResult } from 'simple-git'

export const gitDecorationColorIds = {
  added: 'gitDecoration.addedResourceForeground',
  conflicting: 'gitDecoration.conflictingResourceForeground',
  deleted: 'gitDecoration.deletedResourceForeground',
  ignored: 'gitDecoration.ignoredResourceForeground',
  modified: 'gitDecoration.modifiedResourceForeground',
  renamed: 'gitDecoration.renamedResourceForeground',
  stageDeleted: 'gitDecoration.stageDeletedResourceForeground',
  stageModified: 'gitDecoration.stageModifiedResourceForeground',
  untracked: 'gitDecoration.untrackedResourceForeground'
} as const

const fallbackColorIds = {
  added: '--git-added',
  conflicting: '--git-conflicting',
  deleted: '--git-deleted',
  ignored: '--git-ignored',
  modified: '--git-modified',
  renamed: '--git-renamed',
  stageDeleted: '--git-stage-deleted',
  stageModified: '--git-stage-modified',
  untracked: '--git-untracked'
} satisfies Record<keyof typeof gitDecorationColorIds, string>

const colors = Object.fromEntries(
  Object.entries(gitDecorationColorIds).map(([status, id]) => [
    status,
    `var(--vscode-${id.replace('.', '-')}, var(${
      fallbackColorIds[status as keyof typeof fallbackColorIds]
    }))`
  ])
) as Record<keyof typeof gitDecorationColorIds, string>

const gitDecorationKind = (
  status: FileStatusResult
): keyof typeof gitDecorationColorIds | undefined => {
  const pair = `${status.index}${status.working_dir}`
  if (pair === '!!') return 'ignored'
  if (['AA', 'DD', 'AU', 'UA', 'DU', 'UD', 'UU'].includes(pair)) {
    return 'conflicting'
  }
  if (status.working_dir === 'D') return 'deleted'
  if (status.index === 'D') return 'stageDeleted'
  if (status.working_dir === 'M' || status.working_dir === 'T') return 'modified'
  if (status.index === 'M' || status.index === 'T') return 'stageModified'
  if (pair.includes('R') || pair.includes('C')) return 'renamed'
  if (pair === '??') return 'untracked'
  if (status.index === 'A') return 'added'
  return undefined
}

export const gitDecorationColorId = (
  status: FileStatusResult
): (typeof gitDecorationColorIds)[keyof typeof gitDecorationColorIds] | undefined => {
  const kind = gitDecorationKind(status)
  return kind ? gitDecorationColorIds[kind] : undefined
}

const decoration = (status: FileStatusResult): string | undefined => {
  const kind = gitDecorationKind(status)
  return kind ? colors[kind] : undefined
}

interface DecorationNode {
  children: Map<string, DecorationNode>
  color?: string
  propagate?: boolean
}

const createNode = (): DecorationNode => ({ children: new Map() })

export const createGitStatusColors = (
  root: string,
  statuses: FileStatusResult[]
): Map<string, string> => {
  if (!root) return new Map()
  const separator = root.includes('\\') ? '\\' : '/'
  const normalize = (value: string): string => value.replaceAll(/[\\/]+/g, separator)
  const normalizedRoot = normalize(root)
  const tree = createNode()
  const rootWithSeparator = `${normalizedRoot}${separator}`

  for (const status of statuses) {
    const normalizedPath = normalize(status.path)
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(rootWithSeparator)) continue

    const color = decoration(status)
    if (!color) continue

    const relativePath = normalizedPath.slice(rootWithSeparator.length)
    let node = tree
    for (const segment of relativePath.split(separator)) {
      let child = node.children.get(segment)
      if (!child) {
        child = createNode()
        node.children.set(segment, child)
      }
      node = child
    }
    node.color = color
    node.propagate = `${status.index}${status.working_dir}` !== '!!'
  }

  const decorations = new Map<string, string>()
  const visit = (node: DecorationNode, currentPath: string): string | undefined => {
    if (node.color) decorations.set(currentPath, node.color)

    const children = [...node.children].sort(([left, leftNode], [right, rightNode]) => {
      const leftDirectory = leftNode.children.size > 0
      const rightDirectory = rightNode.children.size > 0
      if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1
      return left.localeCompare(right)
    })
    const childColor = children
      .map(([name, child]) => visit(child, `${currentPath}${separator}${name}`))
      .find(Boolean)
    const color = node.color ?? childColor
    if (color) decorations.set(currentPath, color)
    return node.propagate === false ? undefined : color
  }

  visit(tree, normalizedRoot)
  return decorations
}
