export type WorkbenchTabCloseAction = 'current' | 'others' | 'right'

export function resolveTabCloseTargets(
  tabs: ReadonlyArray<{ readonly id: string }>,
  id: string,
  action: WorkbenchTabCloseAction
): string[] {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return []
  if (action === 'current') return [id]
  if (action === 'others') return tabs.filter((tab) => tab.id !== id).map((tab) => tab.id)
  return tabs.slice(index + 1).map((tab) => tab.id)
}
