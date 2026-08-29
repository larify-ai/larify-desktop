import { type ComponentProps, useEffect, useState } from 'react'
import type { ExtraProps } from 'streamdown'
import { workspaceClient } from '../workspace-client'
import { decodeUrlComponent, resolveWorkspacePath } from './markdown-navigation'

function nodeSource(node: unknown): string | undefined {
  if (!node || typeof node !== 'object' || !('properties' in node)) return undefined
  const properties = node.properties
  if (!properties || typeof properties !== 'object' || !('src' in properties)) return undefined
  return typeof properties.src === 'string' ? properties.src : undefined
}

export function WorkspaceMarkdownImage({
  currentFile,
  resourceId,
  src,
  node,
  ...props
}: ComponentProps<'img'> & ExtraProps & { currentFile: string; resourceId: number }): React.JSX.Element {
  const source = src || nodeSource(node) || ''
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
