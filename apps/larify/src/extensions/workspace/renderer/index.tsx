import { lazy, Suspense } from 'react'
import type { Extension } from '@shared/extension'
import type { View } from '@renderer/types/view'
import { preloadAfterPageLoad } from '@renderer/lib/preload'
import './workspace.css'
import { WorkspaceEmptyState } from './workspace-empty-state'
import { workspaceEditorClient } from './workspace-editor-client'
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

const currentTheme = (): 'dark' | 'light' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light'

const extension: Extension = {
  activate(app, context) {
    app.register('view', 'workspace', {
      sidebar: {
        icon: WorkspaceIcon,
        id: 'workspace',
        label: '审查',
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
      void workspaceEditorClient
        .theme(currentTheme())
        .catch((error) => console.error('[workspace:editor-theme]', error))
      void loadWorkspaceView().catch((error) => console.error('[workspace:preload]', error))
    })
    const observer = new MutationObserver(() => {
      void workspaceEditorClient
        .theme(currentTheme())
        .catch((error) => console.error('[workspace:editor-theme]', error))
    })
    observer.observe(document.documentElement, { attributeFilter: ['class'] })
    context.subscriptions.push({
      dispose: () => {
        cancelPreload()
        observer.disconnect()
      }
    })
  }
}

export default extension
