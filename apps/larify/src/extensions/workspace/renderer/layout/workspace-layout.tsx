import {
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'

const navigatorSize = { default: 200, min: 160, max: 320, step: 10 }
const minimumContentWidth = 280
const clampNavigatorWidth = (width: number): number =>
  Math.max(navigatorSize.min, Math.min(navigatorSize.max, width))

interface LayoutState {
  animating: boolean
  navigatorWidth: number
  visible: boolean
}

const measureNavigatorFit = (body: HTMLElement, state: LayoutState): boolean | undefined => {
  if (state.animating || !state.visible || body.clientWidth === 0) return undefined
  return body.clientWidth >= state.navigatorWidth + minimumContentWidth
}

interface WorkspaceLayoutProps {
  animating?: boolean
  children: ReactNode
  navigator?: ReactNode
  navigatorOpen: boolean
  onNavigatorWidthChange?(width: number): void
  visible?: boolean
}

export function WorkspaceLayout({
  animating = false,
  children,
  navigator,
  navigatorOpen,
  onNavigatorWidthChange,
  visible = true
}: WorkspaceLayoutProps): React.JSX.Element {
  const [navigatorWidth, setNavigatorWidth] = useState(navigatorSize.default)
  const [navigatorFits, setNavigatorFits] = useState(true)
  const [resizingNavigator, setResizingNavigator] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const layoutStateRef = useRef<LayoutState>({ animating, navigatorWidth, visible })
  const resizeStart = useRef<{ pointerX: number; width: number } | null>(null)
  const showNavigator = navigator !== undefined && navigator !== null
  const navigatorVisible = showNavigator && navigatorOpen && navigatorFits

  useLayoutEffect(() => {
    layoutStateRef.current = { animating, navigatorWidth, visible }
    const body = bodyRef.current
    if (!body) return
    const fits = measureNavigatorFit(body, layoutStateRef.current)
    if (fits !== undefined) setNavigatorFits(fits)
  }, [animating, navigatorWidth, visible])

  useLayoutEffect(() => {
    onNavigatorWidthChange?.(navigatorWidth)
  }, [navigatorWidth, onNavigatorWidthChange])

  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    if (typeof ResizeObserver === 'undefined') return
    const update = (): void => {
      const fits = measureNavigatorFit(body, layoutStateRef.current)
      if (fits !== undefined) setNavigatorFits(fits)
    }
    const observer = new ResizeObserver(update)
    observer.observe(body)
    update()
    return () => observer.disconnect()
  }, [])

  const clampToAvailableWidth = (width: number): number => {
    const bodyWidth = bodyRef.current?.clientWidth ?? 0
    const availableWidth = bodyWidth > 0 ? bodyWidth - minimumContentWidth : navigatorSize.max
    return clampNavigatorWidth(Math.min(width, Math.max(navigatorSize.min, availableWidth)))
  }

  const resizeNavigator = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current
    if (!start) return
    setNavigatorWidth(clampToAvailableWidth(start.width + start.pointerX - event.clientX))
  }
  const stopResizing = (): void => {
    resizeStart.current = null
    setResizingNavigator(false)
  }

  return (
    <div
      className="workspace-layout"
      data-constrained={!navigatorFits || undefined}
      data-resizing={resizingNavigator || undefined}
    >
      <div className="workspace-layout-body" ref={bodyRef}>
        <main
          className="workspace-layout-content"
          style={{ marginRight: navigatorVisible ? navigatorWidth : 0 }}
        >
          {children}
        </main>
        {showNavigator && (
          <div
            aria-hidden={!navigatorVisible}
            className="workspace-layout-navigator"
            data-open={navigatorVisible || undefined}
            inert={!navigatorVisible}
            style={{ width: navigatorWidth }}
          >
            <div
              aria-label="调整目录树宽度"
              aria-orientation="vertical"
              aria-valuemax={navigatorSize.max}
              aria-valuemin={navigatorSize.min}
              aria-valuenow={navigatorWidth}
              className="workspace-layout-navigator-handle"
              role="separator"
              tabIndex={navigatorVisible ? 0 : -1}
              onKeyDown={(event) => {
                const direction =
                  event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0
                if (!direction) return
                event.preventDefault()
                setNavigatorWidth((width) =>
                  clampToAvailableWidth(width + direction * navigatorSize.step)
                )
              }}
              onLostPointerCapture={stopResizing}
              onPointerCancel={stopResizing}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                resizeStart.current = { pointerX: event.clientX, width: navigatorWidth }
                setResizingNavigator(true)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={resizeNavigator}
              onPointerUp={(event) => {
                stopResizing()
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }
              }}
            />
            <aside className="workspace-navigator">{navigator}</aside>
          </div>
        )}
      </div>
    </div>
  )
}
