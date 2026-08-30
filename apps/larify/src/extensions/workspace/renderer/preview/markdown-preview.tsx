import { type ComponentProps, type MouseEvent, useLayoutEffect, useMemo, useRef } from 'react'
import {
  MessageResponse,
  type MessageResponseProps
} from '@renderer/components/ai-elements/message'
import { createMessageLink, nodeHref } from '@renderer/components/ai-elements/message-link'
import { createMessageLinkHandler } from '@renderer/app/interaction/assistant/message-links'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import { normalizeModelMarkdownLinks } from '@renderer/lib/model-markdown-links'
import {
  transformWorkspaceUrl,
  workspaceLinkRehypePlugins
} from '@renderer/lib/workspace-markdown-plugins'
import rehypeSlug from 'rehype-slug'
import { type ExtraProps } from 'streamdown'
import { stripYamlFrontmatter } from './markdown-utils'
import { WorkspaceMarkdownImage } from './markdown-image'
import { resolveWorkspacePath } from '@renderer/lib/workspace-link'
import { scrollToHash } from './markdown-navigation'
import { useWorkspaceTextFile } from './use-workspace-text-file'

// Streamdown 不内置 heading id，用 rehype-slug 生成（GitHub 风格：'hello-world'、
// 'hello-world-1'），支撑文档内 #anchor 点击滚动与初始定位。
const previewRehypePlugins = [rehypeSlug, ...workspaceLinkRehypePlugins] as MessageResponseProps['rehypePlugins']

type ImageProps = ComponentProps<'img'> & ExtraProps

export function MarkdownPreview({
  active,
  file,
  resourceId,
  sessionId,
  target
}: PreviewRendererProps): React.JSX.Element {
  const previewRef = useRef<HTMLDivElement>(null)
  const { content, error } = useWorkspaceTextFile(resourceId, file.path, active)
  const markdown = useMemo(
    () =>
      content === undefined ? undefined : normalizeModelMarkdownLinks(stripYamlFrontmatter(content)),
    [content]
  )
  const handler = useMemo(() => {
    const cwd = resolveWorkspacePath(file.path, '.')
    return createMessageLinkHandler(cwd, sessionId)
  }, [file.path, sessionId])
  const components = useMemo(() => {
    const MessageLinkA = createMessageLink(handler)
    return {
      a: (props: ComponentProps<'a'> & ExtraProps): React.JSX.Element => {
        const { href, node } = props
        const hrefValue = href || nodeHref(node)
        const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
          if (hrefValue?.startsWith('#') && previewRef.current) {
            event.preventDefault()
            scrollToHash(previewRef.current, hrefValue.slice(1))
          }
        }
        return <MessageLinkA {...props} onClick={handleClick} />
      },
      img: (props: ImageProps): React.JSX.Element => (
        <WorkspaceMarkdownImage {...props} currentFile={file.path} resourceId={resourceId} />
      )
    }
  }, [file.path, handler, resourceId])

  useLayoutEffect(() => {
    if (target && previewRef.current) scrollToHash(previewRef.current, target.hash)
  }, [markdown, target])

  if (error) return <MarkdownPreviewError message={error} />
  if (markdown === undefined) return <div className="h-full" />

  return (
    <div className="workspace-markdown-preview h-full overflow-auto" ref={previewRef}>
      <MessageResponse
        components={components}
        mode="static"
        rehypePlugins={previewRehypePlugins}
        urlTransform={transformWorkspaceUrl}
      >
        {markdown}
      </MessageResponse>
    </div>
  )
}

function MarkdownPreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
