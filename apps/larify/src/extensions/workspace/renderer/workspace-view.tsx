import { useCallback, useEffect, useRef, useState } from 'react'
import type { ImperativePanelHandle } from 'react-resizable-panels'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup
} from '@renderer/components/ui/resizable'
import { WorkspaceEmptyState } from './workspace-empty-state'
import { workspaceEditorClient } from './workspace-editor-client'
import { WorkspaceEditorViewport } from './workspace-editor-viewport'
import { WorkspaceTree } from './workspace-tree'
import { useGitDecorations } from './use-git-decorations'
import { useWorkspaceExplorer } from './use-workspace-explorer'
import { createGitChangeTree, createPathChangeTree } from './git-change-tree'
import {
  REVIEW_ROUND_EVENT,
  resolveReviewPath,
  takeReviewRound,
  type ReviewRoundRequest,
} from './review-changes'

export function WorkspaceView(): React.JSX.Element {
  const explorerRef = useRef<ImperativePanelHandle>(null)
  const [explorerCollapsed, setExplorerCollapsed] = useState(false)
  const [changesOnly, setChangesOnly] = useState(false)
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [editorRequested, setEditorRequested] = useState(false)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const editorRootRef = useRef<string | null>(null)
  const { entries, loadDirectory, revealFile, root } = useWorkspaceExplorer()
  const {
    available: gitAvailable,
    decorations: gitDecorations,
    statuses: gitStatuses
  } = useGitDecorations(root)
  const revealInTree = useCallback(
    (path: string): void => {
      setRevealPath(path)
      void revealFile(path).catch((error) => console.error('[workspace:reveal-file]', error))
    },
    [revealFile]
  )

  useEffect(() => {
    const rootChanged = editorRootRef.current !== root
    editorRootRef.current = root
    if (rootChanged) {
      setActiveFile(null)
      setRevealPath(null)
    }
    if (!root) return
    void workspaceEditorClient
      .prepare(root)
      .catch((error) => console.error('[workspace-editor:prepare]', error))
  }, [root])

  useEffect(() => {
    const disposeActive = workspaceEditorClient.onActive((file) => {
      setEditorRequested(file !== null)
      setActiveFile(file)
      setRevealPath(file)
    })
    const disposeReveal = workspaceEditorClient.onReveal(revealInTree)
    void workspaceEditorClient
      .state()
      .then(({ activeFile: file }) => {
        if (!file) return
        setEditorRequested(true)
        setActiveFile(file)
        setRevealPath(file)
      })
      .catch((error) => console.error('[workspace-editor:state]', error))
    return () => {
      disposeActive()
      disposeReveal()
    }
  }, [revealInTree])

  useEffect(() => {
    const onActive = (event: Event): void =>
      setWorkbenchVisible((event as CustomEvent<string | null>).detail === 'workspace')
    window.addEventListener('larify:workbench-active', onActive)
    window.dispatchEvent(new Event('larify:workbench-active-request'))
    return () => window.removeEventListener('larify:workbench-active', onActive)
  }, [])

  useEffect(() => {
    if (!activeFile) return
    void revealFile(activeFile).catch((error) => console.error('[workspace:reveal-file]', error))
  }, [activeFile, revealFile])

  useEffect(() => {
    const openRound = (detail: ReviewRoundRequest): void => {
      const selected = detail.files.find((file) => file.path === detail.selectedPath)
      if (!root || !selected) return
      const selectedPath = resolveReviewPath(root, selected.path)
      setChangesOnly(true)
      setRevealPath(selectedPath)
      setEditorRequested(true)
      void workspaceEditorClient
        .openHighlightedDiff(root, selectedPath, selected.patch)
        .catch((error) => console.error('[workspace-editor:open-highlighted-diff]', error))
    }
    const onRound = (event: Event): void => {
      openRound(takeReviewRound() ?? (event as CustomEvent<ReviewRoundRequest>).detail)
    }

    window.addEventListener(REVIEW_ROUND_EVENT, onRound)
    const currentRound = takeReviewRound()
    if (currentRound) openRound(currentRound)
    return () => window.removeEventListener(REVIEW_ROUND_EVENT, onRound)
  }, [root])

  const openFile = useCallback(
    (file: string): void => {
      if (!root) return
      setEditorRequested(true)
      const request = changesOnly
        ? workspaceEditorClient.openDiff(root, file)
        : workspaceEditorClient.open(root, file)
      void request.catch((error) => console.error('[workspace-editor:open]', error))
    },
    [changesOnly, root]
  )

  const treeEntries = root
    ? changesOnly
      ? createGitChangeTree(root, gitStatuses)
      : createPathChangeTree(root, []).map((entry) => ({ ...entry, children: entries }))
    : []

  return (
    <ResizablePanelGroup direction="horizontal" className="workspace-view bg-(--workbench-content)">
      <ResizablePanel
        ref={explorerRef}
        collapsible
        collapsedSize={0}
        defaultSize={22}
        minSize={14}
        maxSize={36}
        onCollapse={() => setExplorerCollapsed(true)}
        onExpand={() => setExplorerCollapsed(false)}
      >
        <div className="flex h-full min-h-0 flex-col bg-secondary p-1.5">
          {root ? (
            <WorkspaceTree
              key={root}
              gitAvailable={gitAvailable}
              gitDecorations={gitDecorations}
              entries={treeEntries}
              changesOnly={changesOnly}
              onOpen={openFile}
              onToggleView={() => setChangesOnly((current) => !current)}
              onToggle={(entry) => {
                void loadDirectory(entry).catch((error) =>
                  console.error('[workspace:load-directory]', error)
                )
              }}
              revealPath={revealPath}
            />
          ) : (
            <div className="flex-1" />
          )}
        </div>
      </ResizablePanel>
      <ResizableHandle
        aria-label="调整文件树宽度"
        className={explorerCollapsed ? 'bg-transparent' : undefined}
        onDoubleClick={() =>
          explorerCollapsed ? explorerRef.current?.expand() : explorerRef.current?.collapse()
        }
      />
      <ResizablePanel minSize={40}>
        <div className="h-full bg-(--workbench-content)">
          {editorRequested ? (
            <WorkspaceEditorViewport visible={workbenchVisible} />
          ) : (
            <WorkspaceEmptyState />
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
