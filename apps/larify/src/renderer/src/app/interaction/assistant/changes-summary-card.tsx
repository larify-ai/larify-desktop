import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
// 预览与卡片在"上/下"两向的间距（对应 mb-1 / mt-1），计算可用空间时一并扣除，
// 避免预览边缘恰好在视口边界外 1px 而被裁。
const PREVIEW_GAP = 4

interface PreviewLayout {
  placement: 'above' | 'below'
  // 预览在所选方向上的可用高度上限；null 表示不限（空间足够）。
  maxHeight: number | null
}

export function ChangesSummaryCard({
  additions,
  deletions,
  files,
  root
}: ChangeSummary): React.JSX.Element {
  const [activePath, setActivePath] = useState<string | null>(null)
  const [layout, setLayout] = useState<PreviewLayout>({ placement: 'above', maxHeight: null })
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

  // 预览放置：只依据"卡片相对视口的上下可用空间"决策，不依赖预览自身高度。
  // 原因：预览内容（@git-diff-view/react + shiki）异步渲染，首次测量只能拿到头部
  // 高度（实测 35px，而最终 323px）。若按未测量高度判断"上方放得下"，就会误放上方，
  // 待内容撑开后溢出视口顶部被裁（用户所见"变更卡片显示不全"）。
  // 现在改为：选空间更大的一侧；若该侧仍容不下预览，则钳制预览高度并让其内部滚动，
  // 从而任何时刻预览都完整落在视口内。
  useLayoutEffect(() => {
    if (!activeFile || !cardRef.current || !previewRef.current) return

    const cardElement = cardRef.current
    const previewElement = previewRef.current
    const viewport = cardElement.closest<HTMLElement>('[data-message-scroll-viewport]')

    // 预览的"自然高度"（未被钳制时应有的高度）。
    // 取三者的最大值：
    //   - 外层 wrapper 的渲染高度：未钳制时即等于自然高度（钳制后会变小，故需下面两项兜底）；
    //   - 内容盒子的渲染高度：兜底无 scrollHeight/无布局的环境（如 jsdom）；
    //   - 头部高度 + 内容区 scrollHeight：钳制后 clientHeight 变小但 scrollHeight 仍是完整
    //     内容高度，用它才不会"钳制→量到变小→解除钳制→再变大"来回抖动。
    const naturalHeight = (): number => {
      const wrapperHeight = previewElement.getBoundingClientRect().height
      const box = previewElement.firstElementChild
      if (!box) return wrapperHeight
      const boxHeight = box.getBoundingClientRect().height
      const body = box.lastElementChild
      if (!body) return Math.max(wrapperHeight, boxHeight)
      const header = box.firstElementChild?.getBoundingClientRect().height ?? 0
      const contentHeight = header + Math.max(body.getBoundingClientRect().height, body.scrollHeight || 0)
      return Math.max(wrapperHeight, boxHeight, contentHeight)
    }

    const updateLayout = (): void => {
      const card = cardElement.getBoundingClientRect()
      const viewportRect = viewport?.getBoundingClientRect()
      const viewportTop = viewportRect?.top ?? 0
      const viewportBottom = viewportRect?.bottom ?? window.innerHeight
      const spaceAbove = card.top - viewportTop - PREVIEW_GAP
      const spaceBelow = viewportBottom - card.bottom - PREVIEW_GAP
      const natural = naturalHeight()
      // 优先保持原有语义：上方放得下就放上方；否则下方放得下就放下方；
      // 两侧都放不下才选空间更大的一侧，并钳制高度（内容内部滚动），避免被裁。
      const placement = spaceAbove >= natural || spaceAbove >= spaceBelow ? 'above' : 'below'
      const available = Math.max(0, placement === 'above' ? spaceAbove : spaceBelow)
      const maxHeight = natural > available ? Math.floor(available) : null
      setLayout((current) =>
        current.placement === placement && current.maxHeight === maxHeight
          ? current
          : { placement, maxHeight }
      )
    }

    updateLayout()
    viewport?.addEventListener('scroll', updateLayout, { passive: true })
    window.addEventListener('resize', updateLayout)
    // 预览内容异步变大（高亮完成）后必须重算：否则首次基于未测量高度的误判会被固化，
    // 只有用户手动 resize/滚动才修正。观察内层预览内容尺寸变化即可。
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateLayout()) : null
    if (observer) {
      observer.observe(previewElement)
      const box = previewElement.firstElementChild
      if (box) {
        observer.observe(box)
        observer.observe(box.lastElementChild ?? box)
      }
    }
    return () => {
      viewport?.removeEventListener('scroll', updateLayout)
      window.removeEventListener('resize', updateLayout)
      observer?.disconnect()
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
            layout.placement === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
          style={
            layout.maxHeight === null
              ? undefined
              : ({ '--larify-preview-max': `${layout.maxHeight}px` } as React.CSSProperties)
          }
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
