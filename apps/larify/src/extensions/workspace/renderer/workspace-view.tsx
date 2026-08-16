import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Code2Icon, ExternalLinkIcon, EyeIcon, FilesIcon } from 'lucide-react'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import {
  type WorkbenchAnimationState,
  workbenchAnimationEvent,
  workbenchStateRequestEvent
} from '@renderer/app/layout/native-layout'
import { Button } from '@renderer/components/ui/button'
import { useWorkbenchTabActions } from '@renderer/app/workbench/workbench-tab-actions'
import { WorkspaceTree } from './explorer/workspace-tree'
import { useGitDecorations } from './changes/use-git-decorations'
import { useWorkspaceExplorer } from './explorer/use-workspace-explorer'
import { createPathChangeTree } from './changes/git-change-tree'
import { WorkspaceLayout } from './layout/workspace-layout'
import { EmptyFilePreview } from './preview/empty-file-preview'
import {
  workspaceMarkdownOpenExternalEvent,
  workspaceMarkdownOpenFileEvent
} from './preview/markdown-navigation'
import {
  REVIEW_ROUND_EVENT,
  takeReviewRound,
  type ReviewRoundRequest
} from './changes/review-changes'

const loadFilePreview = async (): Promise<{
  default: typeof import('./preview/file-preview').FilePreview
}> => {
  const { FilePreview } = await import('./preview/file-preview')
  return { default: FilePreview }
}

const FilePreview = lazy(loadFilePreview)

type WorkspaceViewProps = Omit<WorkbenchRendererProps, 'cwd'>

const isMarkdownPath = (path: string): boolean => /\.(?:md|markdown)$/i.test(path)

export function WorkspaceView({
  active = false,
  resourceId,
  sessionId,
  updateTab
}: WorkspaceViewProps): React.JSX.Element {
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  const [markdownMode, setMarkdownMode] = useState<'preview' | 'source'>('preview')
  const [navigatorWidth, setNavigatorWidth] = useState(200)
  const [workbenchAnimating, setWorkbenchAnimating] = useState(false)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const [lockedPreviewWidth, setLockedPreviewWidth] = useState<number | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lastPreviewWidthRef = useRef(500)
  const navigatorOpenRef = useRef(navigatorOpen)
  const navigatorWidthRef = useRef(navigatorWidth)
  const releasePreviewFrameRef = useRef<number | null>(null)
  const browserRequestRef = useRef(0)
  const revealRequestRef = useRef(0)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const [target, setTarget] = useState<{ hash: string } | undefined>()
  const { entries, loadDirectory, revealFile, root } = useWorkspaceExplorer(resourceId)
  const { decorations: gitDecorations } = useGitDecorations(resourceId, root)

  const selectFile = useCallback((path: string, hash?: string): void => {
    revealRequestRef.current += 1
    setMarkdownMode('preview')
    setTarget(hash ? { hash } : undefined)
    setRevealPath(path)
  }, [])

  const revealWorkspaceFile = useCallback(
    (path: string, hash: string | undefined, errorContext: string): void => {
      const request = ++revealRequestRef.current
      void revealFile(path)
        .then((resolved) => {
          if (!resolved || request !== revealRequestRef.current) return
          selectFile(resolved, hash)
        })
        .catch((error) => console.error(errorContext, error))
    },
    [revealFile, selectFile]
  )

  const openInBrowser = useCallback(
    (url: string, errorContext: string): void => {
      const request = ++browserRequestRef.current
      void window.bridge
        .invoke('resource:create', 'browser', sessionId, { url })
        .then((browserResourceId) => {
          if (request !== browserRequestRef.current) return
          window.dispatchEvent(
            new CustomEvent('larify:workbench-select-resource', {
              detail: { rendererId: 'browser', resourceId: browserResourceId, sessionId }
            })
          )
        })
        .catch((error) => console.error(errorContext, error))
    },
    [sessionId]
  )

  useEffect(() => {
    navigatorOpenRef.current = navigatorOpen
    navigatorWidthRef.current = navigatorWidth
  }, [navigatorOpen, navigatorWidth])

  useEffect(() => {
    const updateAnimation = (event: Event): void => {
      const { animating, visible } = (event as CustomEvent<WorkbenchAnimationState>).detail
      if (animating) {
        if (releasePreviewFrameRef.current !== null) {
          cancelAnimationFrame(releasePreviewFrameRef.current)
          releasePreviewFrameRef.current = null
        }
        if (!visible) {
          const measuredWidth = previewRef.current?.getBoundingClientRect().width ?? 0
          if (measuredWidth > 0) lastPreviewWidthRef.current = measuredWidth
        }
        setLockedPreviewWidth(lastPreviewWidthRef.current)
      } else if (visible) {
        let remainingFrames = 2
        const releaseAtFinalWidth = (): void => {
          const preview = previewRef.current
          const pane = preview?.closest<HTMLElement>('.split-view-view')
          const requiredWidth =
            lastPreviewWidthRef.current + (navigatorOpenRef.current ? navigatorWidthRef.current : 0)
          if (
            pane &&
            pane.getBoundingClientRect().width + 1 < requiredWidth &&
            remainingFrames-- > 0
          ) {
            releasePreviewFrameRef.current = requestAnimationFrame(releaseAtFinalWidth)
            return
          }
          releasePreviewFrameRef.current = null
          setLockedPreviewWidth(null)
        }
        releaseAtFinalWidth()
      } else {
        setLockedPreviewWidth(null)
      }
      setWorkbenchAnimating(animating)
      setWorkbenchVisible(visible)
    }
    window.addEventListener(workbenchAnimationEvent, updateAnimation)
    window.dispatchEvent(new Event(workbenchStateRequestEvent))
    return () => {
      if (releasePreviewFrameRef.current !== null) {
        cancelAnimationFrame(releasePreviewFrameRef.current)
      }
      window.removeEventListener(workbenchAnimationEvent, updateAnimation)
    }
  }, [])

  useEffect(() => {
    updateTab({
      title: revealPath?.split(/[\\/]/).at(-1) ?? '文件',
      tooltip: revealPath ?? '文件'
    })
  }, [revealPath, updateTab])

  useEffect(() => {
    const openFile = (event: Event): void => {
      const {
        hash,
        path,
        resourceId: sourceResourceId
      } = (event as CustomEvent<{ hash?: string; path: string; resourceId: number }>).detail
      if (sourceResourceId !== resourceId) return
      revealWorkspaceFile(path, hash, '[workspace:open-markdown-link]')
    }
    const openExternal = (event: Event): void => {
      const { resourceId: sourceResourceId, url } = (
        event as CustomEvent<{ resourceId: number; url: string }>
      ).detail
      if (sourceResourceId !== resourceId) return
      openInBrowser(url, '[workspace:open-markdown-external]')
    }

    window.addEventListener(workspaceMarkdownOpenFileEvent, openFile)
    window.addEventListener(workspaceMarkdownOpenExternalEvent, openExternal)
    return () => {
      window.removeEventListener(workspaceMarkdownOpenFileEvent, openFile)
      window.removeEventListener(workspaceMarkdownOpenExternalEvent, openExternal)
    }
  }, [openInBrowser, resourceId, revealWorkspaceFile])

  useEffect(() => {
    // Keep Monaco out of the application startup path, but warm its chunk as
    // soon as the user opens the workspace so the first text file opens fast.
    void Promise.all([loadFilePreview(), import('./preview/monaco-preview')]).catch(() => undefined)
  }, [])

  useEffect(() => {
    const revealRound = (detail: ReviewRoundRequest): void => {
      const selected = detail.files.find((file) => file.path === detail.selectedPath)
      if (!root || !selected) return
      revealWorkspaceFile(selected.path, undefined, '[workspace:reveal-file]')
    }
    const onRound = (event: Event): void => {
      revealRound(takeReviewRound() ?? (event as CustomEvent<ReviewRoundRequest>).detail)
    }

    window.addEventListener(REVIEW_ROUND_EVENT, onRound)
    const currentRound = takeReviewRound()
    if (currentRound) revealRound(currentRound)
    return () => window.removeEventListener(REVIEW_ROUND_EVENT, onRound)
  }, [revealWorkspaceFile, root])

  const treeEntries = useMemo(
    () =>
      root ? createPathChangeTree(root, []).map((entry) => ({ ...entry, children: entries })) : [],
    [entries, root]
  )

  const tabActions = useMemo(
    () => (
      <WorkspaceTabActions
        file={revealPath}
        markdownMode={markdownMode}
        navigatorOpen={navigatorOpen}
        onMarkdownModeChange={setMarkdownMode}
        onOpenInBrowser={() => {
          if (!revealPath) return
          openInBrowser(revealPath, '[workspace:open-in-browser]')
        }}
        onToggleNavigator={() => setNavigatorOpen((open) => !open)}
      />
    ),
    [markdownMode, navigatorOpen, openInBrowser, revealPath]
  )
  useWorkbenchTabActions(tabActions)

  if (!root) return <EmptyFilePreview />

  return (
    <WorkspaceLayout
      animating={workbenchAnimating}
      navigatorOpen={navigatorOpen}
      onNavigatorWidthChange={setNavigatorWidth}
      visible={workbenchVisible}
      navigator={
        <WorkspaceTree
          key={root}
          changesOnly={false}
          entries={treeEntries}
          gitDecorations={gitDecorations}
          revealPath={revealPath}
          onOpen={selectFile}
          onToggle={loadDirectory}
        />
      }
    >
      <div
        className="flex h-full w-full min-h-0 flex-col"
        data-preview-animating={workbenchAnimating || undefined}
        ref={previewRef}
        style={lockedPreviewWidth === null ? undefined : { width: lockedPreviewWidth }}
      >
        {revealPath ? (
          <Suspense fallback={null}>
            <FilePreview
              active={active && (workbenchVisible || workbenchAnimating)}
              animating={workbenchAnimating}
              key={`${resourceId}:${revealPath}`}
              mode={isMarkdownPath(revealPath) ? markdownMode : undefined}
              resourceId={resourceId}
              target={target}
              path={revealPath}
            />
          </Suspense>
        ) : (
          <EmptyFilePreview />
        )}
      </div>
    </WorkspaceLayout>
  )
}

function WorkspaceTabActions({
  file,
  markdownMode,
  navigatorOpen,
  onMarkdownModeChange,
  onOpenInBrowser,
  onToggleNavigator
}: {
  file: string | null
  markdownMode: 'preview' | 'source'
  navigatorOpen: boolean
  onMarkdownModeChange(mode: 'preview' | 'source'): void
  onOpenInBrowser(): void
  onToggleNavigator(): void
}): React.JSX.Element {
  const markdown = file ? isMarkdownPath(file) : false
  const html = file ? /\.html?$/i.test(file) : false

  return (
    <>
      {markdown ? (
        <Button
          aria-label={markdownMode === 'preview' ? '查看源码' : '阅读预览'}
          title={markdownMode === 'preview' ? '查看源码' : '阅读预览'}
          variant="ghost"
          size="icon-sm"
          onClick={() => onMarkdownModeChange(markdownMode === 'preview' ? 'source' : 'preview')}
        >
          {markdownMode === 'preview' ? (
            <Code2Icon aria-hidden className="size-4" />
          ) : (
            <EyeIcon aria-hidden className="size-4" />
          )}
        </Button>
      ) : html ? (
        <Button
          aria-label="在内置浏览器中打开"
          title="在内置浏览器中打开"
          variant="ghost"
          size="icon-sm"
          onClick={onOpenInBrowser}
        >
          <ExternalLinkIcon aria-hidden className="size-4" />
        </Button>
      ) : null}
      <Button
        data-workspace-navigator-toggle
        aria-label={navigatorOpen ? '隐藏目录树' : '显示目录树'}
        title={navigatorOpen ? '隐藏目录树' : '显示目录树'}
        variant={navigatorOpen ? 'secondary' : 'ghost'}
        size="icon-sm"
        onClick={onToggleNavigator}
      >
        <FilesIcon className="size-4" />
      </Button>
    </>
  )
}
