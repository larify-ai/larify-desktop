import type { TreeEntry } from './workspace-tree'

const AUTO_EXPAND_LIMIT = 50

export const initialOpenState = (
  entries: TreeEntry[],
  changesOnly: boolean
): Record<string, boolean> => {
  const state: Record<string, boolean> = {}

  const visit = (entry: TreeEntry): void => {
    if (entry.kind !== 'directory') return
    const open =
      entry.root === true ||
      (changesOnly && (entry.children?.length ?? 0) <= AUTO_EXPAND_LIMIT)
    state[entry.path] = open
    entry.children?.forEach(visit)
  }

  entries.forEach(visit)
  return state
}
