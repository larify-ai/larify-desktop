import { useLayoutEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { type Layout, useGroupRef } from 'react-resizable-panels'

interface GroupToggle {
  collapsed: boolean
  groupRef: ReturnType<typeof useGroupRef>
  toggle: () => void
}

export function useGroupToggle(
  panel: string,
  collapsedLayout: Layout,
  initiallyCollapsed = false
): GroupToggle {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const groupRef = useGroupRef()
  const expandedLayout = useRef<Layout | undefined>(undefined)

  useLayoutEffect(() => {
    if (!initiallyCollapsed) return
    const group = groupRef.current
    if (!group) return

    const frame = requestAnimationFrame(() => {
      const current = group.getLayout()
      if ((current[panel] ?? 0) > 0) expandedLayout.current = current
      group.setLayout(collapsedLayout)
    })

    return () => cancelAnimationFrame(frame)
  }, [collapsedLayout, groupRef, initiallyCollapsed, panel])

  const toggle = (): void => {
    const group = groupRef.current
    if (!group) return

    if (collapsed) {
      flushSync(() => setCollapsed(false))
      if (expandedLayout.current) group.setLayout(expandedLayout.current)
    } else {
      const current = group.getLayout()
      if ((current[panel] ?? 0) > 0) expandedLayout.current = current
      flushSync(() => setCollapsed(true))
      group.setLayout(collapsedLayout)
    }
  }

  return {
    collapsed,
    groupRef,
    toggle
  }
}
