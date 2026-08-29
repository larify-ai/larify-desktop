import { type ComponentProps, type MouseEvent, useLayoutEffect, useMemo, useRef } from 'react'
import {
  MessageResponse,
  type MessageResponseProps
} from '@renderer/components/ai-elements/message'
import { createMessageLink } from '@renderer/components/ai-elements/message-link'
import { createMessageLinkHandler } from '@renderer/app/interaction/assistant/message-links'
import type { PreviewRendererProps } from '@renderer/app/registry/file-previews'
import { normalizeModelMarkdownLinks } from '@renderer/lib/model-markdown-links'
import rehypeSlug from 'rehype-slug'
import { defaultRehypePlugins, type ExtraProps } from 'streamdown'
import { stripYamlFrontmatter } from './markdown-utils'
import { WorkspaceMarkdownImage } from './markdown-image'
import { resolveWorkspacePath, scrollToHash } from './markdown-navigation'
import { useWorkspaceTextFile } from './use-workspace-text-file'

// 阻断非 image 的 data URI（避免 XSS 载荷），其余 src/href 原样保留供后续处理。
const transformWorkspaceUrl = (url: string, key: string): string | null => {
  const normalized = url.toLowerCase()
  return key === 'src' && normalized.startsWith('data:') && !normalized.startsWith('data:image/')
    ? null
    : url
}

// 默认 rehype-sanitize 会把盘符（D:/）/file: 协议的 href 剥离，导致 workspace 本地文件
// 链接无法点击。仿 message-markdown.tsx：删除 protocols.href 放行任意协议目标（相对路径
// 与 #anchor 不受影响），src 额外放行 data。javascript:/vbscript: 等危险属性不在此列，
// sanitize 默认仍按属性级规则处理。
function createWorkspaceLinkRehypePlugins(): MessageResponseProps['rehypePlugins'] {
  const sanitize = defaultRehypePlugins.sanitize
  if (!Array.isArray(sanitize)) return [defaultRehypePlugins.raw, sanitize]
  const [plugin, options] = sanitize
  const schema = options as { protocols?: Record<string, string[]> }
  const protocols = { ...schema.protocols }
  delete protocols.href
  protocols.src = [...(protocols.src ?? []), 'data']
  return [defaultRehypePlugins.raw, [plugin, { ...schema, protocols }]]
}

const workspaceLinkRehypePlugins = createWorkspaceLinkRehypePlugins()

// Streamdown 不内置 heading id，用 rehype-slug 生成（GitHub 风格：'hello-world'、
// 'hello-world-1'），支撑文档内 #anchor 点击滚动与初始定位。
const previewRehypePlugins = [rehypeSlug, ...workspaceLinkRehypePlugins!] as MessageResponseProps['rehypePlugins']

type ImageProps = ComponentProps<'img'> & ExtraProps

export function MarkdownPreview({
  active,
  file,
  resourceId,
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
    return createMessageLinkHandler(cwd, '')
  }, [file.path])
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

function nodeHref(node: unknown): string | undefined {
  if (!node || typeof node !== 'object' || !('properties' in node)) return undefined
  const properties = node.properties
  if (!properties || typeof properties !== 'object' || !('href' in properties)) return undefined
  return typeof properties.href === 'string' ? properties.href : undefined
}

function MarkdownPreviewError({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{message}</div>
  )
}
