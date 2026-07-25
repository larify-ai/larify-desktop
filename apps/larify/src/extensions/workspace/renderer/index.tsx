import { lazy, Suspense } from 'react'
import type { Extension } from 'kernel'
import type { View } from '@renderer/types/view'
import './workspace.css'
import { WorkspaceIcon } from './workspace-icon'

let workspaceViewPromise: Promise<{ default: typeof import('./workspace-view').WorkspaceView }> | null =
  null

const loadWorkspaceView = (): NonNullable<typeof workspaceViewPromise> => {
  workspaceViewPromise ??= import('./workspace-view').then(({ WorkspaceView }) => ({
    default: WorkspaceView
  }))
  return workspaceViewPromise
}

const WorkspaceView = lazy(loadWorkspaceView)

const extension: Extension = {
  activate(app) {
    const preload = (): void => {
      void loadWorkspaceView()
    }

    if ('requestIdleCallback' in globalThis) {
      globalThis.requestIdleCallback(preload, { timeout: 1000 })
    } else {
      globalThis.setTimeout(preload, 0)
    }

    app.register('view', 'workspace', {
      sidebar: {
        icon: WorkspaceIcon,
        id: 'workspace',
        label: '工作区',
        order: 6,
        placement: 'content'
      },
      render: () => (
        <Suspense
          fallback={
            <div className="grid h-full w-full place-items-center bg-background text-sm text-muted-foreground">
              加载工作区
            </div>
          }
        >
          <WorkspaceView />
        </Suspense>
      )
    } satisfies View)
  }
}

export default extension
