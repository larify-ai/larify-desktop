import { useEffect, useState } from 'react'
import { FileWarningIcon } from 'lucide-react'
import { useRendererRegistry } from '@renderer/app/registry/renderer-registry'
import { type PreviewRegistry, previewRegistryToken } from '@renderer/app/registry/file-previews'
import type { FileDescriptor } from '../../shared/types'
import { workspaceClient } from '../workspace-client'
import { previewErrorMessage } from './preview-error'
import './file-preview.css'

export function FilePreview({
  active,
  animating,
  descriptor,
  mode,
  path,
  resourceId,
  target
}: {
  active: boolean
  animating: boolean
  descriptor?: FileDescriptor
  mode?: 'preview' | 'source'
  path: string
  resourceId: number
  target?: { hash: string }
}): React.JSX.Element {
  const services = useRendererRegistry()
  const registry = services.get<PreviewRegistry>(previewRegistryToken)
  if (!registry) throw new Error('Preview registry is unavailable.')
  const requestKey = `${resourceId}:${path}`
  const [state, setState] = useState<{
    error?: string
    file?: FileDescriptor
    key: string
  }>({ key: requestKey })

  useEffect(() => {
    if (descriptor) return
    let cancelled = false
    void workspaceClient.inspectFile(resourceId, path).then(
      (file) => !cancelled && setState({ file, key: requestKey }),
      (reason: unknown) =>
        !cancelled &&
        setState({
          error: previewErrorMessage(reason),
          key: requestKey
        })
    )
    return () => {
      cancelled = true
    }
  }, [descriptor, path, requestKey, resourceId])

  const inspected = state.key === requestKey ? state : { error: undefined, file: undefined }
  const error = descriptor ? undefined : inspected.error
  const file = descriptor ?? inspected.file
  if (error) return <UnsupportedPreview message={error} />
  if (!file) return <div className="h-full" />
  const renderer = registry.find(file)
  if (!renderer) return <UnsupportedPreview message={`暂不支持预览 ${file.mime}`} />
  const Renderer = renderer.component
  return (
    <Renderer
      active={active}
      animating={animating}
      file={file}
      mode={mode}
      resourceId={resourceId}
      target={target}
    />
  )
}

function UnsupportedPreview({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-muted-foreground">
      <div className="flex max-w-md flex-col items-center gap-3 px-6 text-center text-sm">
        <FileWarningIcon aria-hidden className="size-8" />
        <span>{message}</span>
      </div>
    </div>
  )
}
