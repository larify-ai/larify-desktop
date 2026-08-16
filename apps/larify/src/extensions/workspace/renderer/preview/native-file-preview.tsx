import { useEffect, useLayoutEffect, useRef } from 'react'
import { nativeLayoutEvent } from '@renderer/app/layout/native-layout'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'

const measureBounds = (
  element: HTMLElement
): { x: number; y: number; width: number; height: number } => {
  const rect = element.getBoundingClientRect()
  const left = Math.round(rect.left)
  const top = Math.round(rect.top)
  const right = Math.round(rect.right)
  const bottom = Math.round(rect.bottom)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function NativeFilePreview({
  active = false,
  animating = false,
  file,
  resourceId
}: PreviewRendererProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const activeRef = useRef(active)

  useLayoutEffect(() => {
    activeRef.current = active
  }, [active])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element || !active) return
    let animationFrame: number | null = null
    let disposed = false
    let previousBounds: { x: number; y: number; width: number; height: number } | null = null
    const report = (): void => {
      if (disposed) return
      // The host owns the preview geometry. Clipping again to the animated
      // Allotment pane feeds transient widths into native PDF/HTML renderers
      // and causes visible reflow. Hidden panes are handled by `active`.
      const bounds = measureBounds(element)
      const changed =
        !previousBounds ||
        previousBounds.x !== bounds.x ||
        previousBounds.y !== bounds.y ||
        previousBounds.width !== bounds.width ||
        previousBounds.height !== bounds.height
      if (!changed) return
      previousBounds = bounds
      window.bridge.sendSync('workspace-preview:setBoundsSync', resourceId, bounds)
    }

    // ResizeObserver already batches notifications after layout and before
    // paint. Adding another animation frame here makes the native view trail
    // the host by exactly one frame.
    const observer = new ResizeObserver(report)
    const trackAnimation = (): void => {
      report()
      animationFrame = requestAnimationFrame(trackAnimation)
    }
    observer.observe(element)
    window.addEventListener(nativeLayoutEvent, report)
    window.addEventListener('resize', report)
    // Apply initial geometry synchronously so the following visibility effect
    // cannot expose a native view at stale bounds.
    report()
    if (animating) {
      animationFrame = requestAnimationFrame(trackAnimation)
    } else {
      // The animation timer and CSS transition have the same duration. Measure
      // once after the next paint boundary so the native view cannot retain the
      // transition's penultimate position.
      animationFrame = requestAnimationFrame(() => {
        animationFrame = null
        report()
      })
    }
    return () => {
      disposed = true
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener(nativeLayoutEvent, report)
      window.removeEventListener('resize', report)
    }
  }, [active, animating, resourceId])

  useLayoutEffect(() => {
    window.bridge.send('workspace-preview:setVisible', resourceId, active)
  }, [active, resourceId])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    void window.bridge
      .invoke(
        'workspace-preview:open',
        resourceId,
        file.path,
        file.mime,
        getComputedStyle(element).backgroundColor,
        measureBounds(element),
        activeRef.current
      )
      .catch((error) => console.error('[workspace:native-preview]', error))
  }, [file.mime, file.path, resourceId])

  useEffect(
    () => () => {
      window.bridge.send('workspace-preview:close', resourceId)
    },
    [resourceId]
  )

  return (
    <div ref={ref} data-testid="native-file-preview" className="h-full min-h-0 bg-background" />
  )
}
