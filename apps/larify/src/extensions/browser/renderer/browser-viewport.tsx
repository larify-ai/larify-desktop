import { useEffect, useRef, type ReactNode } from 'react'
import { nativeLayoutEvent, type NativeLayoutDetail } from '@renderer/app/layout/native-layout'

interface ViewportBounds {
  x: number
  y: number
  width: number
  height: number
}

interface PendingBounds {
  bounds: ViewportBounds
  live: boolean
}

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

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (!visible) {
      void window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)
      return
    }
    const pane = element.closest<HTMLElement>('.larify-workbench-pane, .split-view-view')
    const split = element.closest<HTMLElement>('.larify-workbench-split')
    let previousBounds: ViewportBounds | null = null
    let previousLiveResize = false
    let queuedRequest: PendingBounds | null = null
    let boundsFrame = 0
    let nativeVisible = false
    void window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)

    const flushBounds = (): void => {
      if (boundsFrame) cancelAnimationFrame(boundsFrame)
      boundsFrame = 0
      const request = queuedRequest
      queuedRequest = null
      if (!request) return
      const updated = window.bridge.sendSync(
        'browser:setBoundsSync',
        sessionId,
        resourceId,
        request.bounds,
        request.live,
        true
      )
      if (updated !== true) previousBounds = null
      const shouldShow = updated === true && request.bounds.width > 0 && request.bounds.height > 0
      if (nativeVisible !== shouldShow) {
        nativeVisible = shouldShow
        void window.bridge.invoke('browser:setVisible', sessionId, resourceId, shouldShow)
      }
    }

    const queueRequest = (request: PendingBounds): void => {
      queuedRequest = request
      if (!boundsFrame) boundsFrame = requestAnimationFrame(flushBounds)
    }

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
      const liveResize = split?.hasAttribute('data-resizing') ?? false
      const changed =
        !previousBounds ||
        previousBounds.x !== bounds.x ||
        previousBounds.y !== bounds.y ||
        previousBounds.width !== bounds.width ||
        previousBounds.height !== bounds.height ||
        previousLiveResize !== liveResize
      if (!changed) return
      previousBounds = bounds
      previousLiveResize = liveResize
      queueRequest({
        bounds,
        live: liveResize
      })
    }

    report()
    flushBounds()
    const observer = new ResizeObserver(report)
    observer.observe(element)
    if (pane) observer.observe(pane)
    const reportNativeLayout = (event: Event): void => {
      const detail = (event as CustomEvent<NativeLayoutDetail | undefined>).detail
      report()
      if (detail?.phase !== 'start') flushBounds()
    }
    window.addEventListener(nativeLayoutEvent, reportNativeLayout)
    window.addEventListener('resize', report)
    return () => {
      observer.disconnect()
      if (boundsFrame) cancelAnimationFrame(boundsFrame)
      window.removeEventListener(nativeLayoutEvent, reportNativeLayout)
      window.removeEventListener('resize', report)
      void window.bridge.invoke('browser:setVisible', sessionId, resourceId, false)
    }
  }, [resourceId, sessionId, visible])

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
