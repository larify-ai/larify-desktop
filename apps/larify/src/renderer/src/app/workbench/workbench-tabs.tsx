import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent
} from 'react'
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
import { DropdownMenu } from 'radix-ui'
import type { WorkbenchTabPresentation } from '../registry/workbench-renderers'
import { resolveTabReorder } from './tab-reorder'
import { resolveTabCloseTargets } from './tab-close-actions'
import './workbench-tabs.css'

export interface WorkbenchTab extends WorkbenchTabPresentation {
  id: string
}

interface WorkbenchTabsProps {
  actions?: ReactNode
  activeId: string | null
  tabs: WorkbenchTab[]
  onClose(ids: string[]): void
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
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeId)

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

  useLayoutEffect(() => {
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
        <div
          className="larify-workbench-tabs"
          data-has-active-tab={activeTabIndex >= 0 || undefined}
          data-theme-source="workbench"
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
            <div className="larify-workbench-tab-list" ref={tabListRef} role="tablist">
              {tabs.map((tab, index) => (
                <SortableTab
                  active={tab.id === activeId}
                  canCloseRight={index < tabs.length - 1}
                  focusable={index === Math.max(activeTabIndex, 0)}
                  index={index}
                  key={tab.id}
                  suppressClickRef={suppressClickRef}
                  tab={tab}
                  tabs={tabs}
                  onClose={onClose}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
          {actions && <div className="larify-workbench-tab-actions">{actions}</div>}
        </div>
      </SortableContext>
    </DndContext>
  )
}

const SortableTab = memo(function SortableTab({
  active,
  canCloseRight,
  focusable,
  index,
  suppressClickRef,
  tab,
  tabs,
  onClose,
  onSelect
}: {
  active: boolean
  canCloseRight: boolean
  focusable: boolean
  index: number
  suppressClickRef: React.RefObject<boolean>
  tab: WorkbenchTab
  tabs: WorkbenchTab[]
  onClose(ids: string[]): void
  onSelect(id: string): void
}): React.JSX.Element {
  const { isDragging, listeners, setNodeRef, transform, transition } = useSortable({ id: tab.id })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [titleOverflowing, setTitleOverflowing] = useState(false)

  useEffect(() => {
    const title = titleRef.current
    if (!title) return

    const update = (): void => setTitleOverflowing(title.scrollWidth > title.clientWidth + 1)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(title)
    return () => observer.disconnect()
  }, [tab.title])

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
        <button
          aria-selected={active}
          className="larify-workbench-tab-trigger"
          data-state={active ? 'active' : 'inactive'}
          ref={triggerRef}
          role="tab"
          tabIndex={focusable ? 0 : -1}
          title={tab.tooltip ?? tab.title}
          type="button"
          onClick={() => {
            if (!active) onSelect(tab.id)
          }}
          onKeyDown={(event) => {
            const targetIndex =
              event.key === 'ArrowLeft'
                ? (index - 1 + tabs.length) % tabs.length
                : event.key === 'ArrowRight'
                  ? (index + 1) % tabs.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : -1
            if (targetIndex < 0) return
            event.preventDefault()
            const target = tabs[targetIndex]
            onSelect(target.id)
            event.currentTarget
              .closest('[role="tablist"]')
              ?.querySelectorAll<HTMLElement>('[role="tab"]')
              .item(targetIndex)
              .focus()
          }}
        >
          <span aria-hidden className="larify-workbench-tab-icon">
            {tab.icon}
          </span>
          <span
            className="larify-workbench-tab-title"
            data-overflow={titleOverflowing || undefined}
            ref={titleRef}
          >
            {tab.title}
          </span>
        </button>
        <button
          aria-label={`关闭 ${tab.title}`}
          className="larify-workbench-tab-close"
          title="关闭标签页"
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onClose(resolveTabCloseTargets(tabs, tab.id, 'current'))
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
            onSelect={() => onClose(resolveTabCloseTargets(tabs, tab.id, 'right'))}
          >
            关闭右侧标签页
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
})
