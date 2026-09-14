import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChangesIcon } from '../../../../../extensions/workspace/renderer/changes/changes-icon'
import {
  changesRootForFile,
  requestChangesNavigation
} from '../../../../../extensions/workspace/renderer/changes/changes-navigation'
import {
  requestWorkspaceNavigation,
  workspaceRootForFile
} from '../../../../../extensions/workspace/renderer/workspace-navigation'
import type { ChangeSummary } from './change-summary'
import { ReviewHoverDiff } from './review-hover-diff'

export const HIDE_DELAY = 300
export const HOVER_DELAY = 200
const UPWARD_SWITCH_DELAY = 150
const VIEWPORT_MARGIN = 8

interface PreviewAnchor {
  left: number
  width: number
  top: number
  bottom: number
}

// 预览以 position: fixed 渲染到 body（portal），而不是放在卡片里的 absolute 元素。
// 卡片位于 Virtuoso 滚动容器（overflow:auto）内部，任何 absolute 子元素都会被该容器
// 裁剪——这是 CSS 的固有行为，靠"放置翻转/高度钳制"只能打补丁。挂到 body 后预览不在
// 任何滚动容器内，永不可能被裁剪；这里只需按视口可用空间定位与限高。
function placePreview(anchor: PreviewAnchor): { top: number; left: number; width: number; maxHeight: number } {
  const spaceAbove = anchor.top - VIEWPORT_MARGIN
  const spaceBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN
  const below = spaceAbove < spaceBelow
  return {
    top: below ? anchor.bottom : anchor.top,
    left: anchor.left,
    width: anchor.width,
    maxHeight: Math.max(120, below ? spaceBelow : spaceAbove)
  }
}

export function ChangesSummaryCard({
  additions,
  deletions,
  files,
  root
}: ChangeSummary): React.JSX.Element {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
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
    if (!activeFile || !cardRef.current) {
      setAnchor(null)
      return
    }
    const updateAnchor = (): void => {
      const rect = cardRef.current?.getBoundingClientRect()
      if (!rect) return
      setAnchor((current) =>
        current &&
        current.left === rect.left &&
        current.width === rect.width &&
        current.top === rect.top &&
        current.bottom === rect.bottom
          ? current
          : { bottom: rect.bottom, left: rect.left, top: rect.top, width: rect.width }
      )
    }
    updateAnchor()
    const viewport = cardRef.current.closest<HTMLElement>('[data-message-scroll-viewport]')
    viewport?.addEventListener('scroll', updateAnchor, { passive: true })
    window.addEventListener('resize', updateAnchor)
    return () => {
      viewport?.removeEventListener('scroll', updateAnchor)
      window.removeEventListener('resize', updateAnchor)
    }
  }, [activeFile])

  const openChanges = (selectedPath?: string): void => {
    // A file outside the card root (e.g. ~/.larify tasks/memory artifacts, which
    // live in another repository) has no diff under the root, so the Changes view
    // would show "暂无变更". Open its full text in the Workspace view instead,
    // reusing changesRootForFile to detect "outside" and the anchor-root resolver
    // shared with message links.
    if (root && selectedPath && changesRootForFile(root, selectedPath) !== root) {
      const targetRoot = workspaceRootForFile(root, selectedPath)
      window.dispatchEvent(
        new CustomEvent('larify:workbench-open', {
          detail: {
            rendererId: 'workspace',
            options: { root: targetRoot },
            onOpen: (resourceId: number) =>
              requestWorkspaceNavigation({ path: selectedPath, resourceId })
          }
        })
      )
      return
    }
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
          options: root ? { root } : undefined,
          rendererId: 'changes'
        }
      })
    )
  }

  const placement = anchor ? placePreview(anchor) : null

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
      {activeFile &&
        placement &&
        createPortal(
          <div
            data-testid="changes-preview"
            onMouseEnter={() => {
              clearTimers()
            }}
            onMouseLeave={scheduleHide}
            className="fixed z-50"
            style={{
              left: placement.left,
              width: placement.width,
              maxHeight: placement.maxHeight,
              ...(placement.top === anchor?.bottom
                ? { top: placement.top + 4 }
                : { bottom: window.innerHeight - placement.top + 4 })
            }}
          >
            <ReviewHoverDiff file={activeFile} />
          </div>,
          document.body
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
