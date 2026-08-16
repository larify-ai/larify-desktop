import { useCallback, useEffect, useRef, useState, type ReactNode, type WheelEvent } from 'react'
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { HouseIcon, XIcon } from 'lucide-react'
import { DropdownMenu, Tabs } from 'radix-ui'
import type { WorkbenchTabPresentation } from '../registry/workbench-renderers'
import { resolveTabReorder } from './tab-reorder'
import { resolveTabCloseTargets, type WorkbenchTabCloseAction } from './tab-close-actions'
import './workbench-tabs.css'

export interface WorkbenchTab extends WorkbenchTabPresentation {
  id: string
}

interface WorkbenchTabsProps {
  actions?: ReactNode
  activeId: string | null
  tabs: WorkbenchTab[]
  onClose(id: string): void
  onHome(): void
  onReorder(id: string, fromIndex: number, toIndex: number): void
  onSelect(id: string): void
}

export function WorkbenchTabs({
  actions,
  activeId,
  tabs,
  onClose,
  onHome,
  onReorder,
  onSelect
}: WorkbenchTabsProps): React.JSX.Element {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const suppressClickRef = useRef(false)
  const [scrollEdges, setScrollEdges] = useState('')

  const updateScrollEdges = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth
    setScrollEdges(
      [scroller.scrollLeft > 1 && 'left', scroller.scrollLeft < maxScrollLeft - 1 && 'right']
        .filter(Boolean)
        .join(' ')
    )
  }, [])

  const revealActiveTab = useCallback((): void => {
    const scroller = scrollerRef.current
    if (!activeId || !scroller) return
    const activeTab = Array.from(scroller.querySelectorAll<HTMLElement>('[data-tab-id]')).find(
      (tab) => tab.dataset.tabId === activeId
    )
    if (!activeTab) return

    const tabLeft = activeTab.offsetLeft
    const tabRight = tabLeft + activeTab.offsetWidth
    if (tabLeft < scroller.scrollLeft) scroller.scrollLeft = tabLeft
    else if (tabRight > scroller.scrollLeft + scroller.clientWidth)
      scroller.scrollLeft = tabRight - scroller.clientWidth
    updateScrollEdges()
  }, [activeId, updateScrollEdges])

  useEffect(() => {
    revealActiveTab()
  }, [tabs, revealActiveTab])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      revealActiveTab()
      updateScrollEdges()
    })
    observer.observe(scroller)
    if (tabListRef.current) observer.observe(tabListRef.current)
    return () => observer.disconnect()
  }, [revealActiveTab, updateScrollEdges])

  const finishDrag = (): void => {
    window.setTimeout(() => {
      suppressClickRef.current = false
    }, 0)
  }
  const handleDragEnd = ({ active, over }: DragEndEvent): void => {
    const reorder = resolveTabReorder(tabs, String(active.id), over ? String(over.id) : null)
    if (reorder) onReorder(reorder.id, reorder.fromIndex, reorder.toIndex)
    finishDrag()
  }
  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    const scroller = scrollerRef.current
    if (!scroller || scroller.scrollWidth <= scroller.clientWidth) return
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (!delta) return
    event.preventDefault()
    scroller.scrollLeft += delta
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      modifiers={[restrictToHorizontalAxis]}
      sensors={sensors}
      onDragCancel={finishDrag}
      onDragEnd={handleDragEnd}
      onDragStart={() => {
        suppressClickRef.current = true
      }}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
        <Tabs.Root
          activationMode="automatic"
          className="larify-workbench-tabs"
          data-has-active-tab={activeId !== null || undefined}
          data-theme-source="workbench"
          value={activeId ?? ''}
          onValueChange={onSelect}
        >
          <button
            aria-label="工作台首页"
            className="larify-workbench-home"
            data-active={activeId === null ? true : undefined}
            title="工作台首页"
            type="button"
            onClick={onHome}
          >
            <HouseIcon aria-hidden />
          </button>
          <div
            className="larify-workbench-tab-scroll"
            data-scroll-edges={scrollEdges || undefined}
            ref={scrollerRef}
            onScroll={updateScrollEdges}
            onWheel={handleWheel}
          >
            <Tabs.List className="larify-workbench-tab-list" loop ref={tabListRef}>
              {tabs.map((tab, index) => (
                <SortableTab
                  canCloseRight={index < tabs.length - 1}
                  key={tab.id}
                  suppressClickRef={suppressClickRef}
                  tab={tab}
                  onClose={(action) => {
                    resolveTabCloseTargets(tabs, tab.id, action).forEach((id) => onClose(id))
                  }}
                />
              ))}
            </Tabs.List>
          </div>
          {actions && <div className="larify-workbench-tab-actions">{actions}</div>}
        </Tabs.Root>
      </SortableContext>
    </DndContext>
  )
}

function SortableTab({
  canCloseRight,
  suppressClickRef,
  tab,
  onClose
}: {
  canCloseRight: boolean
  suppressClickRef: React.RefObject<boolean>
  tab: WorkbenchTab
  onClose(action: WorkbenchTabCloseAction): void
}): React.JSX.Element {
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        {...listeners}
        className="larify-workbench-tab"
        data-dragging={isDragging || undefined}
        data-tab-id={tab.id}
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
        onClickCapture={(event) => {
          if (
            suppressClickRef.current &&
            !(event.target as Element).closest('.larify-workbench-tab-close')
          ) {
            event.stopPropagation()
          }
        }}
        onContextMenuCapture={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
      >
        <Tabs.Trigger
          className="larify-workbench-tab-trigger"
          ref={triggerRef}
          title={tab.tooltip ?? tab.title}
          value={tab.id}
        >
          <span aria-hidden className="larify-workbench-tab-icon">
            {tab.icon}
          </span>
          <span className="larify-workbench-tab-title">{tab.title}</span>
        </Tabs.Trigger>
        <button
          aria-label={`关闭 ${tab.title}`}
          className="larify-workbench-tab-close"
          title="关闭标签页"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onClose('current')
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <XIcon aria-hidden />
        </button>
        <DropdownMenu.Trigger asChild>
          <button
            aria-hidden
            className="larify-workbench-tab-menu-anchor"
            tabIndex={-1}
            type="button"
          />
        </DropdownMenu.Trigger>
      </div>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          avoidCollisions={false}
          className="larify-workbench-tab-menu"
          side="bottom"
          sideOffset={4}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <DropdownMenu.Item
            className="larify-workbench-tab-menu-item"
            disabled={!canCloseRight}
            onSelect={() => onClose('right')}
          >
            关闭右侧标签页
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
