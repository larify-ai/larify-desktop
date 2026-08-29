import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BookmarkIcon } from 'lucide-react'

export interface ConversationNavigationEntry {
  id: string
  index: number
  summary: string
  response?: string
}

const bookmarkStorageKey = 'larify:conversation-navigation-bookmarks'
const markerSpacing = 10

function loadBookmarks(): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(bookmarkStorageKey) ?? '[]')
    return new Set(
      Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    )
  } catch {
    return new Set()
  }
}

export function ConversationNavigationRail({
  entries,
  currentIndex,
  onNavigate,
  onLoadOlder
}: {
  entries: ConversationNavigationEntry[]
  currentIndex?: number
  onNavigate: (entry: ConversationNavigationEntry, behavior: 'auto' | 'smooth') => void
  onLoadOlder?: () => void
}): React.JSX.Element | null {
  const rail = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const loadOlderArmed = useRef(true)
  const dragMoved = useRef(false)
  const dragStartY = useRef(0)
  const hoverTimer = useRef<number | null>(null)
  const hoverPointerY = useRef(0)
  const previousEntries = useRef({ firstId: entries[0]?.id, length: entries.length })
  const [bookmarks, setBookmarks] = useState(loadBookmarks)
  const [hovered, setHovered] = useState<{
    entryId: string
    left: number
    top: number
  }>()
  const currentEntry = useMemo(() => {
    if (entries.length === 0 || currentIndex === undefined) return entries.at(-1)
    return entries.reduce((closest, entry) =>
      Math.abs(entry.index - currentIndex) < Math.abs(closest.index - currentIndex)
        ? entry
        : closest
    )
  }, [currentIndex, entries])
  const hoveredEntry = hovered ? entries.find((entry) => entry.id === hovered.entryId) : undefined
  const focusEntryIndex = hoveredEntry
    ? entries.findIndex((entry) => entry.id === hoveredEntry.id)
    : -1
  const toggleBookmark = useCallback((entryId: string): void => {
    setBookmarks((current) => {
      const next = new Set(current)
      if (next.has(entryId)) next.delete(entryId)
      else next.add(entryId)
      try {
        localStorage.setItem(bookmarkStorageKey, JSON.stringify([...next]))
      } catch {
        // Navigation remains usable when storage is unavailable or full.
      }
      return next
    })
  }, [])
  const loadOlderAtTop = useCallback((): void => {
    if (!loadOlderArmed.current) return
    loadOlderArmed.current = false
    onLoadOlder?.()
  }, [onLoadOlder])

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
    },
    []
  )

  useEffect(() => {
    const element = rail.current
    if (!element || !currentEntry) return
    const entryIndex = entries.findIndex((entry) => entry.id === currentEntry.id)
    const markerTop = entryIndex * markerSpacing
    if (markerTop < element.scrollTop) element.scrollTop = markerTop
    else if (markerTop + markerSpacing > element.scrollTop + element.clientHeight) {
      element.scrollTop = markerTop + markerSpacing - element.clientHeight
    }
  }, [currentEntry, entries])

  useLayoutEffect(() => {
    const element = rail.current
    const previous = previousEntries.current
    const added = entries.length - previous.length
    if (element && added > 0 && previous.firstId && entries[0]?.id !== previous.firstId) {
      element.scrollTop += added * markerSpacing
    }
    previousEntries.current = { firstId: entries[0]?.id, length: entries.length }
  }, [entries])

  const entryAt = useCallback(
    (clientY: number): ConversationNavigationEntry | undefined => {
      const bounds = rail.current?.getBoundingClientRect()
      if (!bounds || entries.length === 0) return undefined
      const offset = clientY - bounds.top + (rail.current?.scrollTop ?? 0)
      return entries[
        Math.min(
          entries.length - 1,
          Math.max(0, Math.round((offset - markerSpacing / 2) / markerSpacing))
        )
      ]
    },
    [entries]
  )

  const hoverAt = useCallback(
    (clientY: number): void => {
      const element = rail.current
      const bounds = element?.getBoundingClientRect()
      if (!element || !bounds || entries.length === 0) return
      const offset = clientY - bounds.top + element.scrollTop
      const entryIndex = Math.min(
        entries.length - 1,
        Math.max(0, Math.round((offset - markerSpacing / 2) / markerSpacing))
      )
      const entry = entries[entryIndex]
      if (!entry) return
      const left = bounds.left - 12
      const top = bounds.top + entryIndex * markerSpacing + markerSpacing / 2 - element.scrollTop
      setHovered((current) =>
        current?.entryId === entry.id && current.left === left && current.top === top
          ? current
          : { entryId: entry.id, left, top }
      )
    },
    [entries]
  )

  if (entries.length < 2) return null

  return (
    <>
      <div
        ref={rail}
        className="larify-scrollbar-hidden absolute top-1/2 right-3 z-20 w-8 -translate-y-1/2 touch-none select-none overflow-y-auto"
        style={{
          height: `min(${Math.max(64, Math.min(50, entries.length) * markerSpacing)}px, 70vh, 40rem)`
        }}
        aria-label="对话快速导航"
        onScroll={() => {
          if (hovered) hoverAt(hoverPointerY.current)
        }}
        onWheel={(event) => {
          event.stopPropagation()
          event.preventDefault()
          event.currentTarget.scrollTop += event.deltaY
          if (event.deltaY > 0) loadOlderArmed.current = true
          else if (event.currentTarget.scrollTop <= markerSpacing * 2) loadOlderAtTop()
        }}
        onClick={(event) => {
          if (dragMoved.current && event.detail > 0) {
            dragMoved.current = false
            return
          }
          dragMoved.current = false
          const entryId =
            event.target instanceof Element
              ? event.target.closest<HTMLButtonElement>('[data-navigation-entry]')?.dataset
                  .navigationEntry
              : undefined
          const entry = entryId
            ? entries.find((candidate) => candidate.id === entryId)
            : entryAt(event.clientY)
          if (entry) onNavigate(entry, 'smooth')
        }}
        onPointerEnter={(event) => {
          hoverPointerY.current = event.clientY
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
          hoverTimer.current = window.setTimeout(() => {
            hoverTimer.current = null
            hoverAt(hoverPointerY.current)
          }, 150)
        }}
        onPointerLeave={() => {
          if (hoverTimer.current !== null) {
            window.clearTimeout(hoverTimer.current)
            hoverTimer.current = null
          }
          setHovered(undefined)
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragging.current = true
          dragMoved.current = false
          dragStartY.current = event.clientY
          event.currentTarget.setPointerCapture(event.pointerId)
          hoverAt(event.clientY)
        }}
        onPointerMove={(event) => {
          hoverPointerY.current = event.clientY
          if (dragging.current && Math.abs(event.clientY - dragStartY.current) > 3) {
            dragMoved.current = true
          }
          if (hovered || dragging.current) hoverAt(event.clientY)
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return
          const entry = entryAt(event.clientY)
          dragging.current = false
          event.currentTarget.releasePointerCapture(event.pointerId)
          if (entry && dragMoved.current) {
            if (event.clientY > dragStartY.current + 3) loadOlderArmed.current = true
            if (entry.id === entries[0]?.id) loadOlderAtTop()
            onNavigate(entry, 'auto')
          }
        }}
        onPointerCancel={() => {
          dragging.current = false
          dragMoved.current = false
        }}
      >
        <div className="relative w-full" style={{ height: entries.length * markerSpacing }}>
          {entries.map((entry, entryIndex) => {
            const active = entry.id === currentEntry?.id
            const focused = entry.id === hoveredEntry?.id
            const bookmarked = bookmarks.has(entry.id)
            const distance =
              focusEntryIndex < 0
                ? Number.POSITIVE_INFINITY
                : Math.abs(entryIndex - focusEntryIndex)
            const markerWidth =
              distance === 0
                ? 26
                : distance === 1
                  ? 20
                  : distance === 2
                    ? 14
                    : distance === 3
                      ? 10
                      : 6
            const top = entryIndex * markerSpacing + markerSpacing / 2
            return (
              <button
                key={entry.id}
                type="button"
                className="group absolute right-0 flex h-2 w-8 -translate-y-1/2 items-center justify-end"
                style={{ top }}
                data-navigation-entry={entry.id}
                data-navigation-bookmarked={bookmarked || undefined}
                aria-label={`定位到：${entry.summary}`}
                aria-current={active ? 'true' : undefined}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  toggleBookmark(entry.id)
                }}
              >
                <span
                  className={`block h-0.5 rounded-full transition-[width,background-color,opacity] duration-[160ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                    focused || active
                      ? 'bg-foreground opacity-100'
                      : bookmarked
                        ? 'bg-foreground opacity-65'
                        : 'bg-muted-foreground opacity-30'
                  }`}
                  style={{ width: markerWidth }}
                />
              </button>
            )
          })}
        </div>
      </div>
      {hovered && hoveredEntry
        ? createPortal(
            <div
              data-navigation-preview={hoveredEntry.id}
              className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-1rem)] -translate-x-full -translate-y-1/2 overflow-hidden rounded-xl bg-popover/95 p-2 text-left text-sm leading-5 text-popover-foreground shadow-md ring-1 ring-border/50 backdrop-blur-md"
              style={{ left: hovered.left, top: hovered.top }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{hoveredEntry.summary}</span>
                {bookmarks.has(hoveredEntry.id) ? (
                  <BookmarkIcon className="size-3.5 shrink-0 fill-current text-muted-foreground" />
                ) : null}
              </div>
              {hoveredEntry.response ? (
                <div className="mt-1 line-clamp-3 break-words whitespace-normal text-muted-foreground">
                  {hoveredEntry.response}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
