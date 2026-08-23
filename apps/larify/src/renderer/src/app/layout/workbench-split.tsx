import { useEffect, useRef, useState } from 'react'
import { layoutSpec } from './layout-spec'
import { flushNativeLayout } from './native-layout'

interface WorkbenchSplitProps {
  animated: boolean
  collapsed: boolean
  interaction: React.ReactNode
  workbench: React.ReactNode
}

export function WorkbenchSplit({ animated, collapsed, interaction, workbench }: WorkbenchSplitProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const workbenchRef = useRef<HTMLElement>(null)
  const [workbenchWidth, setWorkbenchWidth] = useState<number>(layoutSpec.workbench.defaultSize)
  const workbenchWidthRef = useRef<number>(layoutSpec.workbench.defaultSize)
  const stopDraggingRef = useRef<() => void>(() => {})

  useEffect(() => () => stopDraggingRef.current(), [])
  useEffect(() => {
    if (collapsed) stopDraggingRef.current()
  }, [collapsed])

  const setWidth = (width: number, maxWidth?: number): void => {
    const availableWidth = maxWidth ?? (containerRef.current?.clientWidth ?? window.innerWidth) - layoutSpec.interaction.minSize
    const nextWidth = Math.max(layoutSpec.workbench.minSize, Math.min(width, availableWidth))
    workbenchWidthRef.current = nextWidth
    workbenchRef.current?.style.setProperty('width', `${nextWidth}px`)
  }

  const startDragging = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const startX = event.clientX
    const startWidth = workbenchRef.current?.getBoundingClientRect().width ?? workbenchWidthRef.current
    const container = containerRef.current
    const maxWidth = (container?.clientWidth ?? window.innerWidth) - layoutSpec.interaction.minSize
    let frame: number | undefined
    let pendingWidth = startWidth
    const move = (moveEvent: PointerEvent): void => {
      moveEvent.preventDefault()
      pendingWidth = startWidth + startX - moveEvent.clientX
      frame ??= window.requestAnimationFrame(() => {
        frame = undefined
        setWidth(pendingWidth, maxWidth)
        flushNativeLayout()
      })
    }
    const cleanup = (): void => {
      if (frame !== undefined) {
        window.cancelAnimationFrame(frame)
        frame = undefined
      }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      stopDraggingRef.current = () => {}
      container?.removeAttribute('data-resizing')
    }
    const stop = (): void => {
      cleanup()
      setWidth(pendingWidth, maxWidth)
      setWorkbenchWidth(workbenchWidthRef.current)
      flushNativeLayout({ phase: 'end' })
    }
    const cancel = (): void => {
      cleanup()
      flushNativeLayout({ phase: 'end' })
    }
    stopDraggingRef.current()
    stopDraggingRef.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    container?.setAttribute('data-resizing', 'true')
    flushNativeLayout({ phase: 'start' })
  }

  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const direction = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
    if (direction === 0) return
    event.preventDefault()
    setWidth(workbenchWidthRef.current + direction * 10)
    setWorkbenchWidth(workbenchWidthRef.current)
    flushNativeLayout()
  }

  return (
    <div ref={containerRef} className={`larify-workbench-split min-h-0 flex-1${animated ? ' larify-workbench-split-animated' : ''}`}>
      <div className="larify-interaction-pane relative h-full min-w-0 flex-1 overflow-hidden [contain:layout_paint]">
        {interaction}
        {!collapsed && <div aria-label="调整工作台宽度" aria-orientation="vertical" aria-valuemin={layoutSpec.workbench.minSize} aria-valuenow={Math.round(workbenchWidth)} className="larify-workbench-resize-handle" data-interaction-min-size={layoutSpec.interaction.minSize} data-workbench-min-size={layoutSpec.workbench.minSize} onKeyDown={resizeWithKeyboard} onPointerDown={startDragging} role="separator" tabIndex={0} />}
      </div>
      <aside ref={workbenchRef} aria-hidden={collapsed} className="larify-workbench-pane relative h-full shrink-0 overflow-hidden [contain:layout_paint]" style={{ maxWidth: `calc(100% - ${layoutSpec.interaction.minSize}px)`, width: collapsed ? 0 : workbenchWidth }}>
        <div className="h-full w-full overflow-hidden" style={{ minWidth: layoutSpec.workbench.minSize }}>{workbench}</div>
      </aside>
    </div>
  )
}
