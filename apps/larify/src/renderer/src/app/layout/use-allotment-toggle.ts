import { useCallback, useEffect, useRef, useState } from 'react'

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
  // useCallback 保证 toggle 引用稳定，使 React.memo 包裹的子树不会因父组件重渲染
  // （如 animating 状态在 180ms 后复位）而被反复重建。
  const toggle = useCallback((): void => {
    window.clearTimeout(animationTimer.current)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    setAnimating(!reduceMotion)
    setCollapsed((current) => !current)
    animationTimer.current = reduceMotion
      ? undefined
      : window.setTimeout(() => setAnimating(false), animationDuration)
  }, [])

  useEffect(() => () => window.clearTimeout(animationTimer.current), [])

  return { animating, collapsed, setCollapsed, toggle }
}
