import { useState } from 'react'

export function useAllotmentToggle(initiallyCollapsed = false): {
  collapsed: boolean
  toggle(): void
} {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const toggle = (): void => setCollapsed((current) => !current)

  return { collapsed, toggle }
}
