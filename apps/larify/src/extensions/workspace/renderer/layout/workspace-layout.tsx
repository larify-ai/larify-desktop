import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

const navigatorSize = { default: 200, min: 160, max: 320, step: 10 }
const clampNavigatorWidth = (width: number): number =>
  Math.max(navigatorSize.min, Math.min(navigatorSize.max, width))

interface WorkspaceLayoutProps {
  children: ReactNode
  navigator?: ReactNode
  navigatorOpen: boolean
}

export function WorkspaceLayout({
  children,
  navigator,
  navigatorOpen
}: WorkspaceLayoutProps): React.JSX.Element {
  const [navigatorWidth, setNavigatorWidth] = useState(navigatorSize.default)
  const [resizingNavigator, setResizingNavigator] = useState(false)
  const resizeStart = useRef<{ pointerX: number; width: number } | null>(null)
  const showNavigator = navigator !== undefined && navigator !== null
  const navigatorVisible = showNavigator && navigatorOpen

  const resizeNavigator = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const start = resizeStart.current
    if (!start) return
    setNavigatorWidth(clampNavigatorWidth(start.width + start.pointerX - event.clientX))
  }
  const stopResizing = (): void => {
    resizeStart.current = null
    setResizingNavigator(false)
  }

  return (
    <div className="workspace-layout" data-resizing={resizingNavigator || undefined}>
      <div className="workspace-layout-body">
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
                  clampNavigatorWidth(width + direction * navigatorSize.step)
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
