import { useEffect, useRef, useState } from 'react'
import { ChangesIcon } from '../../../../../extensions/workspace/renderer/changes/changes-icon'
import {
  changesRootForFile,
  requestChangesNavigation
} from '../../../../../extensions/workspace/renderer/changes/changes-navigation'
import type { ChangeSummary } from './change-summary'
import { ReviewHoverDiff } from './review-hover-diff'

const HIDE_DELAY = 600
const UPWARD_SWITCH_DELAY = 150

export function ChangesSummaryCard({
  additions,
  deletions,
  files,
  root
}: ChangeSummary): React.JSX.Element {
  const [activePath, setActivePath] = useState<string | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const moveDir = useRef<'up' | 'down' | null>(null)
  const activeFile = files.find(({ path }) => path === activePath)

  const clearHide = (): void => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current)
      hideTimer.current = null
    }
  }
  const clearSwitch = (): void => {
    if (switchTimer.current) {
      clearTimeout(switchTimer.current)
      switchTimer.current = null
    }
  }
  const scheduleHide = (): void => {
    clearHide()
    clearSwitch()
    hideTimer.current = setTimeout(() => {
      hideTimer.current = null
      setActivePath(null)
    }, HIDE_DELAY)
  }
  const showFile = (path: string): void => {
    clearHide()
    clearSwitch()
    if (activeFile && moveDir.current === 'up') {
      switchTimer.current = setTimeout(() => {
        switchTimer.current = null
        setActivePath(path)
      }, UPWARD_SWITCH_DELAY)
    } else {
      setActivePath(path)
    }
  }

  useEffect(
    () => () => {
      clearHide()
      clearSwitch()
    },
    []
  )

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
          onMouseEnter={() => {
            clearHide()
            clearSwitch()
          }}
          onMouseLeave={scheduleHide}
          className="pointer-events-auto absolute inset-x-0 bottom-full z-50 mb-1"
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
        <div className="max-h-[calc(9.5rem+1px)] overflow-y-auto [scrollbar-gutter:stable] border-t border-border bg-muted/20 px-2 py-1.5">
          {files.map((file) => (
            <button
              key={file.path}
              type="button"
              onFocus={
                file.binary
                  ? undefined
                  : () => {
                      moveDir.current = null
                      showFile(file.path)
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
