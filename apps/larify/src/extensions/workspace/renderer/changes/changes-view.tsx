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
import { createGitChangeTree, isGitChange } from './git-change-tree'
import { useGitDecorations } from './use-git-decorations'

const MonacoDiff = lazy(() =>
  import('./monaco-diff').then(({ MonacoDiff }) => ({ default: MonacoDiff }))
)

export function ChangesView({
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
  const [selected, setSelected] = useState<string | null>(null)
  const { decorations, error, loading, statuses } = useGitDecorations(resourceId, cwd, {
    includeIgnored: false
  })
  const changes = useMemo(() => statuses.filter(isGitChange), [statuses])
  const entries = useMemo(() => createGitChangeTree(cwd, statuses), [cwd, statuses])
  const hasChanges = changes.length > 0
  const current = changes.find((status) => status.path === selected) ?? changes[0] ?? null
  const selectedPath = current?.path ?? null

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
            onOpen={setSelected}
            onToggle={async () => undefined}
          />
        ) : null
      }
    >
      {current ? (
        <Suspense fallback={<div className="h-full" />}>
          <MonacoDiff
            key={`${current.from ?? ''}:${current.path}`}
            mode={mode}
            resourceId={resourceId}
            root={cwd}
            status={current}
          />
        </Suspense>
      ) : error ? (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">{error}</div>
      ) : loading ? (
        <div className="h-full" />
      ) : (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">暂无变更</div>
      )}
    </WorkspaceLayout>
  )
}
