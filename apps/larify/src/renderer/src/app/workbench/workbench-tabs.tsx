import { useMemo, useRef, useState, type ReactNode } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { cn } from '../../lib/utils'
import './workbench-tabs.css'

export interface WorkbenchTab {
  active?: boolean
  closable?: boolean
  icon?: ReactNode
  id: string
  title: string
}

interface WorkbenchTabsProps {
  draggable?: boolean
  newLabel?: string
  tabs: WorkbenchTab[]
  onClose?(id: string): void
  onCreate?(): void
  onReorder?(id: string, fromIndex: number, toIndex: number): void
  onSelect(id: string): void
}

interface DragMeasure {
  centerX: number
  id: string
  left: number
  right: number
  width: number
}

interface DragState {
  draggedWidth: number
  id: string
  offsetX: number
  originIndex: number
  targetIndex: number
}

export function WorkbenchTabs({
  draggable = false,
  newLabel = '新建',
  tabs,
  onClose,
  onCreate,
  onReorder,
  onSelect
}: WorkbenchTabsProps): React.JSX.Element {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const didDragRef = useRef(false)
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const dragMeasuresRef = useRef<DragMeasure[]>([])
  const dragBoundsRef = useRef<{ left: number; right: number } | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const tabIndexes = useMemo(() => new Map(tabs.map((tab, index) => [tab.id, index])), [tabs])
  const hasActiveTab = tabs.some((tab) => tab.active)

  const measureTabs = (): DragMeasure[] => {
    if (!scrollRef.current) return []
    return Array.from(scrollRef.current.querySelectorAll<HTMLElement>('.larify-workbench-tab'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          centerX: rect.left + rect.width / 2,
          id: element.dataset.tabId ?? '',
          left: rect.left,
          right: rect.right,
          width: rect.width
        }
      })
      .filter((measure) => measure.id.length > 0)
  }

  const clampDragOffset = (draggingId: string, offsetX: number): number => {
    const bounds = dragBoundsRef.current
    const dragged = dragMeasuresRef.current.find((measure) => measure.id === draggingId)
    if (!bounds || !dragged) return offsetX
    if (bounds.right <= bounds.left) return offsetX
    const minOffset = bounds.left - dragged.left
    const maxOffset = bounds.right - dragged.right
    return Math.max(minOffset, Math.min(offsetX, maxOffset))
  }

  const getTargetIndex = (draggingId: string, currentCenterX: number): number => {
    const measures = dragMeasuresRef.current
    return measures.filter(
      (measure) => measure.id !== draggingId && currentCenterX >= measure.centerX
    ).length
  }

  const stopDragging = (): void => {
    dragStateRef.current = null
    setDragState(null)
    dragMeasuresRef.current = []
    dragBoundsRef.current = null
    dragStartPointRef.current = null
  }

  const clearDragClickGuard = (): void => {
    window.setTimeout(() => {
      didDragRef.current = false
    }, 0)
  }

  const getTabTransform = (tabId: string): string | undefined => {
    const state = dragState
    if (!state) return undefined
    if (tabId === state.id) return `translateX(${state.offsetX}px) translateY(-1px)`

    const index = tabIndexes.get(tabId)
    if (index === undefined || state.originIndex === state.targetIndex) return undefined
    if (
      state.targetIndex > state.originIndex &&
      index > state.originIndex &&
      index <= state.targetIndex
    ) {
      return `translateX(-${state.draggedWidth}px)`
    }
    if (
      state.targetIndex < state.originIndex &&
      index >= state.targetIndex &&
      index < state.originIndex
    ) {
      return `translateX(${state.draggedWidth}px)`
    }
    return undefined
  }

  return (
    <div className="larify-workbench-tabs" data-theme-source="workbench">
      {hasActiveTab ? (
        <span aria-hidden className="larify-workbench-tabs-active-base" />
      ) : null}
      <div
        className="larify-workbench-tabs-scroll larify-scrollbar-hidden"
        ref={scrollRef}
        role="tablist"
      >
        {tabs.map((tab, index) => {
          const active = tab.active === true
          const closable = tab.closable ?? true
          const dragging = dragState?.id === tab.id
          const transform = getTabTransform(tab.id)

          return (
            <div
              aria-selected={active}
              className={cn(
                'larify-workbench-tab',
                active && 'larify-workbench-tab-active',
                dragging && 'larify-workbench-tab-dragging',
                dragState && !dragging && 'larify-workbench-tab-sorting'
              )}
              data-tab-id={tab.id}
              key={tab.id}
              style={
                transform
                  ? {
                      transform
                    }
                  : undefined
              }
              onClick={(event) => {
                if (didDragRef.current) {
                  event.preventDefault()
                  didDragRef.current = false
                  return
                }
                onSelect(tab.id)
              }}
              onPointerDown={(event) => {
                if (!draggable || event.button !== 0) return
                const originIndex = tabIndexes.get(tab.id)
                if (originIndex === undefined) return
                const measures = measureTabs()
                const draggedWidth =
                  measures.find((measure) => measure.id === tab.id)?.width ?? 0
                dragMeasuresRef.current = measures
                dragBoundsRef.current = scrollRef.current?.getBoundingClientRect() ?? null
                const state = {
                  draggedWidth,
                  id: tab.id,
                  offsetX: 0,
                  originIndex,
                  targetIndex: originIndex
                }
                dragStateRef.current = state
                setDragState(state)
                dragStartPointRef.current = { x: event.clientX, y: event.clientY }
                didDragRef.current = false
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                const state = dragStateRef.current
                if (!state || !dragStartPointRef.current) return
                const deltaX = event.clientX - dragStartPointRef.current.x
                const deltaY = Math.abs(event.clientY - dragStartPointRef.current.y)
                if (Math.abs(deltaX) < 4 && deltaY < 4) return
                const offsetX = clampDragOffset(state.id, deltaX)
                didDragRef.current = true
                const dragged = dragMeasuresRef.current.find((measure) => measure.id === state.id)
                const targetIndex = dragged
                  ? getTargetIndex(state.id, dragged.centerX + offsetX)
                  : state.targetIndex
                const nextState = { ...state, offsetX, targetIndex }
                dragStateRef.current = nextState
                setDragState(nextState)
              }}
              onPointerUp={() => {
                const state = dragStateRef.current
                if (state && didDragRef.current && state.originIndex !== state.targetIndex) {
                  onReorder?.(state.id, state.originIndex, state.targetIndex)
                }
                stopDragging()
                if (didDragRef.current) clearDragClickGuard()
              }}
              onPointerCancel={() => {
                stopDragging()
                didDragRef.current = false
              }}
              role="tab"
              tabIndex={active || (!hasActiveTab && index === 0) ? 0 : -1}
              title={tab.title}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(tab.id)
                  return
                }
                const offset =
                  event.key === 'ArrowLeft'
                    ? -1
                    : event.key === 'ArrowRight'
                      ? 1
                      : event.key === 'Home'
                        ? -index
                        : event.key === 'End'
                          ? tabs.length - 1 - index
                          : 0
                if (offset === 0) return
                event.preventDefault()
                const nextIndex = (index + offset + tabs.length) % tabs.length
                const next = tabs[nextIndex]
                if (!next) return
                onSelect(next.id)
                scrollRef.current
                  ?.querySelectorAll<HTMLElement>('.larify-workbench-tab')
                  .item(nextIndex)
                  .focus()
              }}
            >
              {tab.icon ? (
                <span aria-hidden className="larify-workbench-tab-icon-node">
                  {tab.icon}
                </span>
              ) : null}
              <span className="larify-workbench-tab-title">{tab.title}</span>
              {closable ? (
                <button
                  aria-label="关闭"
                  className="larify-workbench-tab-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    event.currentTarget.blur()
                    onClose?.(tab.id)
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  title="关闭"
                  type="button"
                >
                  <XIcon aria-hidden className="larify-workbench-tab-icon-svg" />
                </button>
              ) : null}
              {active ? (
                <>
                  <span
                    aria-hidden
                    className="larify-workbench-tab-corner larify-workbench-tab-corner-left"
                  />
                  <span
                    aria-hidden
                    className="larify-workbench-tab-corner larify-workbench-tab-corner-right"
                  />
                </>
              ) : null}
            </div>
          )
        })}
      </div>
      {onCreate ? (
        <div className="larify-workbench-tabs-actions">
          <Button
            aria-label={newLabel}
            className="larify-workbench-tab-create"
            onClick={onCreate}
            size="icon-xs"
            title={newLabel}
            variant="ghost"
          >
            <PlusIcon className="larify-workbench-tab-icon-svg" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
