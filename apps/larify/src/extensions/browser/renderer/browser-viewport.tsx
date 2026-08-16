import { useEffect, useRef, useState, type ReactNode } from 'react'
import { nativeLayoutEvent } from '@renderer/app/layout/native-layout'

interface BrowserViewportProps {
  children?: ReactNode
  resourceId: number
  sessionId: string
  visible: boolean
}

export function BrowserViewport({
  children,
  resourceId,
  sessionId,
  visible
}: BrowserViewportProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [viewportHasSize, setViewportHasSize] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const pane = element.closest<HTMLElement>('.split-view-view')
    let previousBounds: { x: number; y: number; width: number; height: number } | null = null
    void window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)

    const report = (): void => {
      const rect = element.getBoundingClientRect()
      const paneRect = pane?.getBoundingClientRect()
      const left = Math.round(Math.max(rect.left, paneRect?.left ?? rect.left))
      const top = Math.round(Math.max(rect.top, paneRect?.top ?? rect.top))
      const right = Math.round(Math.max(left, Math.min(rect.right, paneRect?.right ?? rect.right)))
      const bottom = Math.round(
        Math.max(top, Math.min(rect.bottom, paneRect?.bottom ?? rect.bottom))
      )
      const bounds = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      }
      const changed =
        !previousBounds ||
        previousBounds.x !== bounds.x ||
        previousBounds.y !== bounds.y ||
        previousBounds.width !== bounds.width ||
        previousBounds.height !== bounds.height
      if (!changed) return
      previousBounds = bounds
      setViewportHasSize(bounds.width > 0 && bounds.height > 0)
      window.bridge.sendSync('browser:setBoundsSync', sessionId, resourceId, bounds)
    }

    report()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    if (pane) observer.observe(pane)
    window.addEventListener(nativeLayoutEvent, report)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      window.removeEventListener(nativeLayoutEvent, report)
      window.removeEventListener('resize', report)
      void window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)
    }
  }, [resourceId, sessionId])

  useEffect(() => {
    void window.bridge.invoke(
      'browser:setVisible',
      sessionId,
      resourceId,
      visible && viewportHasSize
    )
  }, [resourceId, sessionId, visible, viewportHasSize])

  return (
    <div
      ref={ref}
      className="relative min-h-0 flex-1 overflow-hidden bg-background"
      data-testid="browser-viewport"
    >
      {children}
    </div>
  )
}
