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
import { type PreviewRegistry, previewRegistryToken } from '@renderer/app/registry/file-previews'
import { NativeFilePreview } from './preview/native-file-preview'

const WorkspaceView = lazy(() =>
  import('./workspace-view').then(({ WorkspaceView }) => ({ default: WorkspaceView }))
)
const MonacoPreview = lazy(() =>
  import('./preview/monaco-preview').then(({ MonacoPreview }) => ({ default: MonacoPreview }))
)

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
          mime === 'text/html' ||
          mime.startsWith('image/') ||
          mime.startsWith('audio/') ||
          mime.startsWith('video/')
      }),
      previews.register({
        component: (props) => (
          <Suspense fallback={null}>
            <MonacoPreview {...props} />
          </Suspense>
        ),
        supports: (file) => !file.binary || file.mime.startsWith('text/')
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
        order: 30,
        title: '文件'
      })
    )
  }
}

export default plugin
