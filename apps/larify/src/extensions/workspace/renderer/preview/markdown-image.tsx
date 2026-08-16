import { useEffect, useState } from 'react'
import type { ComponentProps } from '@ant-design/x-markdown'
import { workspaceClient } from '../workspace-client'
import { decodeUrlComponent, resolveWorkspacePath } from './markdown-navigation'

export function MarkdownImage({
  currentFile,
  domNode: _domNode,
  resourceId,
  src,
  streamStatus: _streamStatus,
  ...props
}: ComponentProps & { currentFile: string; resourceId: number }): React.JSX.Element {
  void _domNode
  void _streamStatus
  const source = typeof src === 'string' ? src : ''
  const remote = /^(?:data:|blob:|https?:|\/\/)/i.test(source)
  const remoteSource = source.startsWith('//') ? `https:${source}` : source
  const path =
    source && !remote
      ? resolveWorkspacePath(currentFile, decodeUrlComponent(source.split(/[?#]/, 1)[0]))
      : undefined
  const assetKey = path ? `${resourceId}\0${path}` : undefined
  const [asset, setAsset] = useState<{ key: string; url: string }>()

  useEffect(() => {
    if (!assetKey || !path) return
    let cancelled = false
    let url: string | undefined
    void workspaceClient.readAsset(resourceId, path).then(
      ({ bytes, mime }) => {
        if (cancelled) return
        url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }))
        setAsset({ key: assetKey, url })
      },
      () => undefined
    )
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [assetKey, path, resourceId])

  return (
    <img
      {...props}
      src={asset && asset.key === assetKey ? asset.url : remote ? remoteSource : undefined}
    />
  )
}
