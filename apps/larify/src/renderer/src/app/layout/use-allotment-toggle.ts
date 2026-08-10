import { useEffect, useRef, useState } from 'react'

const animationDuration = 180

export function useAllotmentToggle(initiallyCollapsed = false): {
  animating: boolean
  collapsed: boolean
  toggle(): void
} {
  const animationTimer = useRef<number | undefined>(undefined)
  const [animating, setAnimating] = useState(false)
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const toggle = (): void => {
    window.clearTimeout(animationTimer.current)
    setAnimating(true)
    setCollapsed((current) => !current)
    animationTimer.current = window.setTimeout(() => setAnimating(false), animationDuration)
  }

  useEffect(() => () => window.clearTimeout(animationTimer.current), [])

  return { animating, collapsed, toggle }
}
