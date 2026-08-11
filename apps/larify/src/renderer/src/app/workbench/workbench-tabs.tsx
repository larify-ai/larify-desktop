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
import { resolveTabReorder } from './tab-reorder'
import { resolveTabCloseTargets, type WorkbenchTabCloseAction } from './tab-close-actions'
import './workbench-tabs.css'

export interface WorkbenchTab {
  id: string
  icon: ReactNode
  title: string
}

interface WorkbenchTabsProps {
  activeId: string | null
  tabs: WorkbenchTab[]
  onClose(id: string): void
  onHome(): void
  onReorder(id: string, fromIndex: number, toIndex: number): void
  onSelect(id: string): void
}

export function WorkbenchTabs({
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
    const next = [
      scroller.scrollLeft > 1 && 'left',
      scroller.scrollLeft < maxScrollLeft - 1 && 'right'
    ]
      .filter(Boolean)
      .join(' ')
    setScrollEdges(next)
  }, [])

  useEffect(() => {
    if (!activeId) return
    const activeTab = Array.from(
      scrollerRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? []
    ).find((tab) => tab.dataset.tabId === activeId)
    const scroller = scrollerRef.current
    if (!activeTab || !scroller) return

    const tabLeft = activeTab.offsetLeft
    const tabRight = tabLeft + activeTab.offsetWidth
    if (tabLeft < scroller.scrollLeft) scroller.scrollLeft = tabLeft
    else if (tabRight > scroller.scrollLeft + scroller.clientWidth)
      scroller.scrollLeft = tabRight - scroller.clientWidth
    updateScrollEdges()
  }, [activeId, tabs, updateScrollEdges])

  useEffect(() => {
    updateScrollEdges()
  }, [tabs, updateScrollEdges])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateScrollEdges)
    observer.observe(scroller)
    if (tabListRef.current) observer.observe(tabListRef.current)
    return () => observer.disconnect()
  }, [updateScrollEdges])

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
                  canCloseOthers={tabs.length > 1}
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
        </Tabs.Root>
      </SortableContext>
    </DndContext>
  )
}

function SortableTab({
  canCloseOthers,
  canCloseRight,
  suppressClickRef,
  tab,
  onClose
}: {
  canCloseOthers: boolean
  canCloseRight: boolean
  suppressClickRef: React.RefObject<boolean>
  tab: WorkbenchTab
  onClose(action: WorkbenchTabCloseAction): void
}): React.JSX.Element {
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuWidth, setMenuWidth] = useState(0)

  return (
    <DropdownMenu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        {...listeners}
        className="larify-workbench-tab"
        data-dragging={isDragging || undefined}
        data-tab-id={tab.id}
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
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
          const rect = event.currentTarget.getBoundingClientRect()
          setMenuWidth(rect.width)
          setMenuOpen(true)
        }}
      >
        <Tabs.Trigger
          className="larify-workbench-tab-trigger"
          ref={triggerRef}
          title={tab.title}
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
          style={{ width: menuWidth }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            triggerRef.current?.focus()
          }}
        >
          <DropdownMenu.Item
            className="larify-workbench-tab-menu-item"
            disabled={!canCloseOthers}
            onSelect={() => onClose('others')}
          >
            关闭其他标签页
          </DropdownMenu.Item>
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
