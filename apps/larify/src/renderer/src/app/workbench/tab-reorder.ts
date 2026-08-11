export function resolveTabReorder(
  tabs: ReadonlyArray<{ readonly id: string }>,
  activeId: string,
  overId: string | null
): { id: string; fromIndex: number; toIndex: number } | null {
  if (overId === null || activeId === overId) return null
  const fromIndex = tabs.findIndex((tab) => tab.id === activeId)
  const toIndex = tabs.findIndex((tab) => tab.id === overId)
  return fromIndex === -1 || toIndex === -1 ? null : { id: activeId, fromIndex, toIndex }
}
