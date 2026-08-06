import { useLayoutEffect, useRef, useState } from 'react'
import { useGroupRef } from 'react-resizable-panels'

type Layout = Record<string, number>

interface GroupToggle {
  collapsed: boolean
  groupRef: ReturnType<typeof useGroupRef>
  toggle: () => void
}

export function useGroupToggle(
  panel: string,
  collapsedLayout: Layout,
  expandedLayout: Layout,
  initiallyCollapsed = false
): GroupToggle {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const groupRef = useGroupRef()
  const expanded = useRef(expandedLayout)

  useLayoutEffect(() => {
    const group = groupRef.current
    if (!group) return

    const frame = requestAnimationFrame(() => {
      if (collapsed) {
        const current = group.getLayout()
        if ((current[panel] ?? 0) > 0) expanded.current = current
        group.setLayout(collapsedLayout)
      } else {
        group.setLayout(expanded.current)
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [collapsed, collapsedLayout, groupRef, panel])

  return {
    collapsed,
    groupRef,
    toggle: () => setCollapsed((value) => !value)
  }
}
