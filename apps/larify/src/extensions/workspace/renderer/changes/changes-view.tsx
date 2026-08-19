import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Columns2Icon, FilesIcon, Rows3Icon } from 'lucide-react'
import type { WorkbenchRendererProps } from '@renderer/app/registry/workbench-renderers'
import { useWorkbenchTabActions } from '@renderer/app/workbench/workbench-tab-actions'
import { Button } from '@renderer/components/ui/button'
import {
  type WorkbenchAnimationState,
  workbenchAnimationEvent,
  workbenchStateRequestEvent
} from '@renderer/app/layout/native-layout'
import { WorkspaceTree } from '../explorer/workspace-tree'
import { WorkspaceLayout } from '../layout/workspace-layout'
import { workspaceClient } from '../workspace-client'
import { createGitChangeTree, isGitChange } from './git-change-tree'
import { useGitDecorations } from './use-git-decorations'
import {
  CHANGES_NAVIGATION_EVENT,
  peekChangesNavigation,
  resolveChangesPath,
  sameChangesPath,
  takeChangesNavigation,
  type ChangesNavigationRequest
} from './changes-navigation'

const MonacoDiff = lazy(() =>
  import('./monaco-diff').then(({ MonacoDiff }) => ({ default: MonacoDiff }))
)

export function ChangesView({
  active = false,
  cwd,
  resourceId,
  updateTab
}: WorkbenchRendererProps): React.JSX.Element {
  const [mode, setMode] = useState<'unified' | 'split'>('unified')
  const [navigatorOpen, setNavigatorOpen] = useState(true)
  const [workbenchState, setWorkbenchState] = useState<WorkbenchAnimationState>({
    animating: false,
    visible: false
  })
  const [workspace, setWorkspace] = useState({ resourceId, root: cwd || null })
  const root = workspace.resourceId === resourceId ? workspace.root : cwd || null
  const [selection, setSelection] = useState(() => ({
    path: peekChangesNavigation(resourceId)?.path ?? null,
    resourceId
  }))
  const selected = selection.resourceId === resourceId ? selection.path : null
  const { decorations, error, loading, statuses } = useGitDecorations(resourceId, root, {
    includeIgnored: false
  })
  const changes = useMemo(() => statuses.filter(isGitChange), [statuses])
  const entries = useMemo(() => (root ? createGitChangeTree(root, statuses) : []), [root, statuses])
  const hasChanges = changes.length > 0
  const requestedPath = selected && root ? resolveChangesPath(root, selected) : selected
  const current = selected
    ? changes.find((status) => root && sameChangesPath(root, status.path, requestedPath!)) ?? null
    : changes[0] ?? null
  const selectedPath = current?.path ?? null
  const previewActive = active && (workbenchState.visible || workbenchState.animating)

  useEffect(() => {
    let alive = true
    void workspaceClient
      .readDirectory(resourceId)
      .then((listing) => {
        if (alive) setWorkspace({ resourceId, root: listing.root })
      })
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [resourceId])

  useEffect(() => {
    const show = (request: ChangesNavigationRequest): void => {
      setSelection({ path: request.path, resourceId })
    }
    const onNavigate = (event: Event): void => {
      const detail = (event as CustomEvent<ChangesNavigationRequest>).detail
      if (detail.resourceId !== resourceId) return
      show(takeChangesNavigation(resourceId) ?? detail)
    }
    window.addEventListener(CHANGES_NAVIGATION_EVENT, onNavigate)
    const pending = takeChangesNavigation(resourceId)
    if (pending) show(pending)
    return () => window.removeEventListener(CHANGES_NAVIGATION_EVENT, onNavigate)
  }, [resourceId])

  useEffect(() => {
    const update = (event: Event): void => {
      setWorkbenchState((event as CustomEvent<WorkbenchAnimationState>).detail)
    }
    window.addEventListener(workbenchAnimationEvent, update)
    window.dispatchEvent(new Event(workbenchStateRequestEvent))
    return () => window.removeEventListener(workbenchAnimationEvent, update)
  }, [])

  useEffect(() => {
    updateTab({ title: '变更', tooltip: selectedPath ?? '全部变更' })
  }, [selectedPath, updateTab])

  const actions = useMemo(
    () =>
      hasChanges ? (
        <>
          <Button
            aria-label={mode === 'unified' ? '切换到拆分视图' : '切换到统一视图'}
            title={mode === 'unified' ? '拆分视图' : '统一视图'}
            variant="ghost"
            size="icon-sm"
            onClick={() => setMode((value) => (value === 'unified' ? 'split' : 'unified'))}
          >
            {mode === 'unified' ? (
              <Columns2Icon className="size-4" />
            ) : (
              <Rows3Icon className="size-4" />
            )}
          </Button>
          <Button
            aria-label={navigatorOpen ? '隐藏变更目录树' : '显示变更目录树'}
            title={navigatorOpen ? '隐藏变更目录树' : '显示变更目录树'}
            variant={navigatorOpen ? 'secondary' : 'ghost'}
            size="icon-sm"
            onClick={() => setNavigatorOpen((open) => !open)}
          >
            <FilesIcon className="size-4" />
          </Button>
        </>
      ) : null,
    [hasChanges, mode, navigatorOpen]
  )
  useWorkbenchTabActions(actions)

  return (
    <WorkspaceLayout
      animating={workbenchState.animating}
      navigatorOpen={hasChanges && navigatorOpen}
      visible={workbenchState.visible}
      navigator={
        hasChanges ? (
          <WorkspaceTree
            changesOnly
            entries={entries}
            gitDecorations={decorations}
            revealPath={selectedPath}
            onOpen={(path) =>
              setSelection({
                path,
                resourceId
              })
            }
            onToggle={async () => undefined}
          />
        ) : null
      }
    >
      {current ? (
        <Suspense fallback={<div className="h-full" />}>
          <MonacoDiff
            active={previewActive}
            animating={workbenchState.animating}
            key={`${current.from ?? ''}:${current.path}`}
            mode={mode}
            resourceId={resourceId}
            root={root ?? cwd}
            status={current}
          />
        </Suspense>
      ) : error ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">{error}</div>
      ) : loading ? (
        <div className="h-full" />
      ) : selected ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          无法定位该变更文件
        </div>
      ) : (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">暂无变更</div>
      )}
    </WorkspaceLayout>
  )
}
