import { lazy, Suspense } from 'react'
import { SquareCode } from 'lucide-react'
import type { RendererPlugin } from '@renderer/app/registry/renderer-plugins'
import {
  type WorkbenchRendererRegistry,
  workbenchRendererRegistryToken
} from '@renderer/app/registry/workbench-renderers'
import './workspace.css'
import './layout/workspace-layout.css'
import { EmptyFilePreview } from './preview/empty-file-preview'
import {
  type PreviewRegistry,
  type PreviewRendererProps,
  previewRegistryToken
} from '@renderer/app/registry/file-previews'
import { ChangesIcon } from './changes/changes-icon'
import { EmptyChangesPreview } from './changes/empty-changes-preview'
import { loadChangesView, preloadChangesEditor } from './changes/changes-loaders'
import { invalidateGitStatus } from './changes/git-status-invalidation'

const WorkspaceView = lazy(() =>
  import('./workspace-view').then(({ WorkspaceView }) => ({ default: WorkspaceView }))
)
const ChangesView = lazy(() =>
  loadChangesView().then(({ ChangesView }) => ({ default: ChangesView }))
)
const MonacoPreview = lazy(() =>
  import('./preview/monaco-preview').then(({ MonacoPreview }) => ({ default: MonacoPreview }))
)
const MarkdownPreview = lazy(() =>
  import('./preview/markdown-preview').then(({ MarkdownPreview }) => ({ default: MarkdownPreview }))
)

function renderMarkdownFilePreview(props: PreviewRendererProps): React.JSX.Element {
  const Renderer = props.mode === 'source' ? MonacoPreview : MarkdownPreview
  return (
    <Suspense fallback={null}>
      <Renderer {...props} />
    </Suspense>
  )
}

const plugin: RendererPlugin = {
  id: 'workspace',
  activate({ registry, subscriptions }) {
    const renderers = registry.get<WorkbenchRendererRegistry>(workbenchRendererRegistryToken)
    if (!renderers) throw new Error('Workbench renderer registry is unavailable.')
    const previews = registry.get<PreviewRegistry>(previewRegistryToken)
    if (!previews) throw new Error('Preview registry is unavailable.')

    const bridge = typeof window === 'undefined' ? undefined : window.bridge
    const unbindTerminal = bridge?.on('terminal:command-finished', (payload) => {
      const cwd = (payload as { cwd?: unknown } | undefined)?.cwd
      if (typeof cwd === 'string') invalidateGitStatus(cwd)
    })
    if (unbindTerminal) subscriptions.push({ dispose: () => void unbindTerminal() })

    const preload = (): void => {
      void preloadChangesEditor().catch(() => undefined)
    }
    if (typeof requestIdleCallback === 'function') {
      const idle = requestIdleCallback(preload)
      subscriptions.push({ dispose: () => cancelIdleCallback(idle) })
    }

    subscriptions.push(
      previews.register({
        component: renderMarkdownFilePreview,
        priority: 50,
        supports: ({ binary, mime, path }) =>
          !binary && (mime === 'text/markdown' || /\.(?:md|markdown)$/i.test(path))
      }),
      previews.register({
        component: (props) => (
          <Suspense fallback={null}>
            <MonacoPreview {...props} />
          </Suspense>
        ),
        supports: (file) => !file.binary
      })
    )

    subscriptions.push(
      renderers.register('workspace', {
        component: ({ active, resourceId, sessionId, updateTab }) => (
          <Suspense fallback={<EmptyFilePreview />}>
            <WorkspaceView
              active={active ?? false}
              resourceId={resourceId}
              sessionId={sessionId}
              updateTab={updateTab}
            />
          </Suspense>
        ),
        icon: <SquareCode aria-hidden className="larify-workbench-icon-file" />,
        order: 10,
        title: '文件'
      })
    )
    subscriptions.push(
      renderers.register('changes', {
        component: (props) => (
          <Suspense fallback={<EmptyChangesPreview />}>
            <ChangesView {...props} />
          </Suspense>
        ),
        icon: <ChangesIcon className="larify-workbench-icon-changes" />,
        order: 20,
        title: '变更'
      })
    )
  }
}

export default plugin
