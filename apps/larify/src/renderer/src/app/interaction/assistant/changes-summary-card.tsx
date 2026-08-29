import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChangesIcon } from '../../../../../extensions/workspace/renderer/changes/changes-icon'
import {
  changesRootForFile,
  requestChangesNavigation
} from '../../../../../extensions/workspace/renderer/changes/changes-navigation'
import type { ChangeSummary } from './change-summary'
import { ReviewHoverDiff } from './review-hover-diff'

export const HIDE_DELAY = 300
export const HOVER_DELAY = 200
const UPWARD_SWITCH_DELAY = 150

export function ChangesSummaryCard({
  additions,
  deletions,
  files,
  root
}: ChangeSummary): React.JSX.Element {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [previewPlacement, setPreviewPlacement] = useState<'above' | 'below'>('above')
  const cardRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveDir = useRef<'up' | 'down' | null>(null)
  const activeFile = files.find(({ path }) => path === activePath)

  const clearTimers = (): void => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
    if (switchTimer.current) {
      clearTimeout(switchTimer.current)
      switchTimer.current = null
    }
  }
  const scheduleHide = (): void => {
    clearTimers()
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      setActivePath(null)
    }, HIDE_DELAY)
  }
  const showFile = (path: string, delay = HOVER_DELAY): void => {
    clearTimers()
    const applySwitch = (): void => {
      switchTimer.current = null
      setActivePath(path)
    }
    const wait = activeFile && moveDir.current === 'up' ? UPWARD_SWITCH_DELAY : delay
    if (wait > 0) {
      switchTimer.current = setTimeout(applySwitch, wait)
    } else {
      applySwitch()
    }
  }

  useEffect(
    () => () => {
      clearTimers()
    },
    []
  )

  useEffect(() => {
    if (activePath && !files.some(({ path }) => path === activePath)) setActivePath(null)
  }, [activePath, files])

  useLayoutEffect(() => {
    if (!activeFile || !cardRef.current || !previewRef.current) return

    const viewport = cardRef.current.closest<HTMLElement>('[data-message-scroll-viewport]')
    const updatePlacement = (): void => {
      if (!cardRef.current || !previewRef.current) return
      const card = cardRef.current.getBoundingClientRect()
      const previewHeight = previewRef.current.getBoundingClientRect().height
      const viewportRect = viewport?.getBoundingClientRect()
      const viewportTop = viewportRect?.top ?? 0
      const viewportBottom = viewportRect?.bottom ?? window.innerHeight
      const spaceAbove = card.top - viewportTop
      const spaceBelow = viewportBottom - card.bottom
      const nextPlacement =
        spaceAbove >= previewHeight || spaceAbove >= spaceBelow ? 'above' : 'below'

      setPreviewPlacement((current) => (current === nextPlacement ? current : nextPlacement))
    }

    updatePlacement()
    viewport?.addEventListener('scroll', updatePlacement, { passive: true })
    window.addEventListener('resize', updatePlacement)
    return () => {
      viewport?.removeEventListener('scroll', updatePlacement)
      window.removeEventListener('resize', updatePlacement)
    }
  }, [activeFile])

  const openChanges = (selectedPath?: string): void => {
    const targetRoot = root && selectedPath ? changesRootForFile(root, selectedPath) : root
    window.dispatchEvent(
      new CustomEvent('larify:workbench-open', {
        detail: {
          onOpen: selectedPath
            ? (resourceId: number) =>
                requestChangesNavigation({
                  path: selectedPath,
                  resourceId
                })
            : undefined,
          options: targetRoot ? { root: targetRoot } : undefined,
          rendererId: 'changes'
        }
      })
    )
  }

  return (
    <div
      ref={cardRef}
      className="relative mt-3"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) scheduleHide()
      }}
      onMouseLeave={scheduleHide}
      onMouseMove={(event) => {
        if (event.movementY < -1) moveDir.current = 'up'
        else if (event.movementY > 1) moveDir.current = 'down'
      }}
    >
      {activeFile && (
        <div
          ref={previewRef}
          onMouseEnter={() => {
            clearTimers()
          }}
          onMouseLeave={scheduleHide}
          className={`pointer-events-auto absolute inset-x-0 z-50 ${
            previewPlacement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <ReviewHoverDiff file={activeFile} />
        </div>
      )}
      <section
        aria-label={`已编辑 ${files.length} 个文件`}
        className="not-prose w-full overflow-hidden rounded-xl border border-border bg-card"
      >
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-3 py-3 pr-[calc(1rem+var(--larify-scrollbar-size))] pl-4 text-left hover:bg-muted/40"
          onClick={() => openChanges()}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <ChangesIcon aria-hidden className="size-5" />
          </span>
          <span className="min-w-0 flex-1 text-sm font-medium">已编辑 {files.length} 个文件</span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
            <span className="text-[var(--git-added)]">+{additions}</span>
            <span className="text-[var(--git-deleted)]">−{deletions}</span>
          </span>
        </button>
        <div
          data-message-local-scroll
          className="max-h-[calc(9.5rem+1px)] overflow-y-auto overscroll-contain [scrollbar-gutter:stable] border-t border-border bg-muted/20 px-2 py-1.5"
        >
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onFocus={
                file.binary
                  ? undefined
                  : () => {
                      moveDir.current = null
                      showFile(file.path, 0)
                    }
              }
              onMouseEnter={file.binary ? undefined : () => showFile(file.path)}
              className="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md pr-2 pl-3.5 text-left text-xs hover:bg-muted"
              onClick={() => openChanges(file.path)}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className="shrink-0 font-mono text-[var(--git-added)]">+{file.additions}</span>
              <span className="shrink-0 font-mono text-[var(--git-deleted)]">
                −{file.deletions}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
