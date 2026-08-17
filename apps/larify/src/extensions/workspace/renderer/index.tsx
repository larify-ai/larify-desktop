import { lazy, Suspense } from 'react'
import { FileText } from 'lucide-react'
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
import { NativeFilePreview } from './preview/native-file-preview'
import { ChangesIcon } from './changes/changes-icon'

const WorkspaceView = lazy(() =>
  import('./workspace-view').then(({ WorkspaceView }) => ({ default: WorkspaceView }))
)
const ChangesView = lazy(() =>
  import('./changes/changes-view').then(({ ChangesView }) => ({ default: ChangesView }))
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

    subscriptions.push(
      previews.register({
        component: NativeFilePreview,
        priority: 100,
        supports: ({ mime }) =>
          mime === 'application/pdf' ||
          mime.startsWith('image/') ||
          mime.startsWith('audio/') ||
          mime.startsWith('video/')
      }),
      previews.register({
        component: renderMarkdownFilePreview,
        priority: 50,
        supports: ({ binary, mime, path }) =>
          !binary && (mime === 'text/markdown' || /\.md$/i.test(path))
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
        icon: <FileText aria-hidden />,
        order: 10,
        title: '文件'
      })
    )
    subscriptions.push(
      renderers.register('changes', {
        component: (props) => (
          <Suspense fallback={<EmptyFilePreview />}>
            <ChangesView {...props} />
          </Suspense>
        ),
        icon: <ChangesIcon />,
        order: 20,
        title: '变更'
      })
    )
  }
}

export default plugin
