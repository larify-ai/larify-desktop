import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { FilesIcon } from 'lucide-react'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import {
  type WorkbenchAnimationState,
  workbenchAnimationEvent,
  workbenchStateRequestEvent
} from '@renderer/app/layout/native-layout'
import { useWorkbenchTabActions } from '@renderer/app/workbench/workbench-tab-actions'
import { Button } from '@renderer/components/ui/button'
import { WorkspaceTree } from './explorer/workspace-tree'
import { ChangesIcon } from './changes/changes-icon'
import { useGitDecorations } from './changes/use-git-decorations'
import { useWorkspaceExplorer } from './explorer/use-workspace-explorer'
import { createGitChangeTree, createPathChangeTree } from './changes/git-change-tree'
import { WorkspaceLayout } from './layout/workspace-layout'
import { EmptyFilePreview } from './preview/empty-file-preview'
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

export function WorkspaceView({
  active = false,
  resourceId,
  updateTab
}: WorkspaceViewProps): React.JSX.Element {
  const [changesOnly, setChangesOnly] = useState(false)
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  const [navigatorWidth, setNavigatorWidth] = useState(200)
  const [workbenchAnimating, setWorkbenchAnimating] = useState(false)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const [lockedPreviewWidth, setLockedPreviewWidth] = useState<number | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const lastPreviewWidthRef = useRef(500)
  const navigatorOpenRef = useRef(navigatorOpen)
  const navigatorWidthRef = useRef(navigatorWidth)
  const releasePreviewFrameRef = useRef<number | null>(null)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const { entries, loadDirectory, revealFile, root } = useWorkspaceExplorer(resourceId)
  const { decorations: gitDecorations, statuses: gitStatuses } = useGitDecorations(resourceId, root)
  const tabActions = useMemo(
    () => (
      <>
        <Button
          aria-label={changesOnly ? '显示全部文件' : '仅显示变更文件'}
          title={changesOnly ? '显示全部文件' : '仅显示变更文件'}
          variant={changesOnly ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => setChangesOnly(!changesOnly)}
        >
          <ChangesIcon className="size-4" />
        </Button>
        <Button
          data-workspace-navigator-toggle
          aria-label={navigatorOpen ? '隐藏目录树' : '显示目录树'}
          title={navigatorOpen ? '隐藏目录树' : '显示目录树'}
          variant={navigatorOpen ? 'secondary' : 'ghost'}
          size="icon-sm"
          onClick={() => {
            setNavigatorOpen(!navigatorOpen)
          }}
        >
          <FilesIcon className="size-4" />
        </Button>
      </>
    ),
    [changesOnly, navigatorOpen]
  )
  useWorkbenchTabActions(tabActions)

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
    updateTab({ title: revealPath?.split(/[\\/]/).at(-1) ?? '文件' })
  }, [revealPath, updateTab])

  useEffect(() => {
    // Keep Monaco out of the application startup path, but warm its chunk as
    // soon as the user opens the workspace so the first text file opens fast.
    void Promise.all([loadFilePreview(), import('./preview/monaco-preview')]).catch(() => undefined)
  }, [])

  useEffect(() => {
    const revealRound = (detail: ReviewRoundRequest): void => {
      const selected = detail.files.find((file) => file.path === detail.selectedPath)
      if (!root || !selected) return
      setChangesOnly(true)
      void revealFile(selected.path)
        .then((path) => path && setRevealPath(path))
        .catch((error) => console.error('[workspace:reveal-file]', error))
    }
    const onRound = (event: Event): void => {
      revealRound(takeReviewRound() ?? (event as CustomEvent<ReviewRoundRequest>).detail)
    }

    window.addEventListener(REVIEW_ROUND_EVENT, onRound)
    const currentRound = takeReviewRound()
    if (currentRound) revealRound(currentRound)
    return () => window.removeEventListener(REVIEW_ROUND_EVENT, onRound)
  }, [revealFile, root])

  const treeEntries = root
    ? changesOnly
      ? createGitChangeTree(root, gitStatuses)
      : createPathChangeTree(root, []).map((entry) => ({ ...entry, children: entries }))
    : []

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
          changesOnly={changesOnly}
          entries={treeEntries}
          gitDecorations={gitDecorations}
          revealPath={revealPath}
          onOpen={setRevealPath}
          onToggle={loadDirectory}
        />
      }
    >
      <div
        className="h-full w-full"
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
              resourceId={resourceId}
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
