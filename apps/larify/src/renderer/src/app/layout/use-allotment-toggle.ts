import { useEffect, useRef, useState } from 'react'

const animationDuration = 180

export function useAllotmentToggle(initiallyCollapsed = false): {
  animating: boolean
  collapsed: boolean
  setCollapsed(collapsed: boolean): void
  toggle(): void
} {
  const animationTimer = useRef<number | undefined>(undefined)
  const [animating, setAnimating] = useState(false)
  const [collapsed, setCollapsed] = useState(initiallyCollapsed)
  const toggle = (): void => {
    window.clearTimeout(animationTimer.current)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setAnimating(!reduceMotion)
    setCollapsed((current) => !current)
    animationTimer.current = reduceMotion
      ? undefined
      : window.setTimeout(() => setAnimating(false), animationDuration)
  }

  useEffect(() => () => window.clearTimeout(animationTimer.current), [])

  return { animating, collapsed, setCollapsed, toggle }
}
