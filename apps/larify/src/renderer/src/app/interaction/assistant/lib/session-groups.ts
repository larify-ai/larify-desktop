export interface SessionGroupState {
  open: Set<string>
  expanded: Set<string>
}

export function toggleSessionGroup(
  open: Set<string>,
  expanded: Set<string>,
  group: string
): SessionGroupState {
  const nextOpen = new Set(open)
  const nextExpanded = new Set(expanded)
  if (nextOpen.has(group)) {
    nextOpen.delete(group)
    nextExpanded.delete(group)
  } else {
    nextOpen.add(group)
  }
  return { open: nextOpen, expanded: nextExpanded }
}
