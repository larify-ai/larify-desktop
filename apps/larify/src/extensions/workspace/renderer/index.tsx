import { lazy, Suspense } from 'react'
import type { Extension } from 'kernel'
import type { View } from '@renderer/types/view'
import { preloadAfterPageLoad } from '@renderer/lib/preload'
import './workspace.css'
import { WorkspaceEmptyState } from './workspace-empty-state'
import { WorkspaceIcon } from './workspace-icon'

let workspaceViewPromise: Promise<{
  default: typeof import('./workspace-view').WorkspaceView
}> | null = null

const loadWorkspaceView = (): NonNullable<typeof workspaceViewPromise> => {
  if (!workspaceViewPromise) {
    const start = 'larify:workspace-view-load:start'
    performance.mark(start)
    workspaceViewPromise = import('./workspace-view')
      .then(({ WorkspaceView }) => ({ default: WorkspaceView }))
      .catch((error) => {
        workspaceViewPromise = null
        throw error
      })
      .finally(() => {
        performance.measure('larify:workspace-view-load', start)
        performance.clearMarks(start)
      })
  }
  return workspaceViewPromise
}

const WorkspaceView = lazy(loadWorkspaceView)

const extension: Extension = {
  activate(app, context) {
    app.register('view', 'workspace', {
      sidebar: {
        icon: WorkspaceIcon,
        id: 'workspace',
        label: '评审',
        order: 6,
        placement: 'content'
      },
      render: () => (
        <Suspense fallback={<WorkspaceEmptyState />}>
          <WorkspaceView />
        </Suspense>
      )
    } satisfies View)
    const cancelPreload = preloadAfterPageLoad(() => {
      void loadWorkspaceView().catch((error) => console.error('[workspace:preload]', error))
    })
    context.subscriptions.push({ dispose: cancelPreload })
  }
}

export default extension
