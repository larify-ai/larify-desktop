import type { ComponentProps, MouseEvent } from 'react'
import { cn } from '@renderer/lib/utils'
import { parseWorkspaceLink } from '@renderer/lib/workspace-link'

export interface MessageLinkTarget {
  kind: 'file' | 'url'
  target: string
}

export type MessageLinkHandler = (link: MessageLinkTarget) => void

export type MessageLinkProps = ComponentProps<'a'> & {
  node?: unknown
  onOpenLink?: MessageLinkHandler
  /** XMarkdown 渲染时额外传入、但不属于 <a> 的属性，接收后丢弃以免透传到 DOM。 */
  domNode?: unknown
  streamStatus?: unknown
}

/** 从 hast 节点（Streamdown components.a 的 node prop）提取 href，供 href 缺失时兜底。 */
// eslint-disable-next-line react-refresh/only-export-components
export function nodeHref(node: unknown): string | undefined {
  if (!node || typeof node !== 'object' || !('properties' in node)) return undefined
  const properties = node.properties
  if (!properties || typeof properties !== 'object' || !('href' in properties)) return undefined
  return typeof properties.href === 'string' ? properties.href : undefined
}

export function MessageLink({
  href,
  children,
  className,
  node,
  onClick,
  onOpenLink,
  domNode: _domNode,
  streamStatus: _streamStatus,
  ...rest
}: MessageLinkProps): React.JSX.Element {
  // Streamdown 额外传入的属性，接收后丢弃以免透传到 DOM。
  const target = href ?? nodeHref(node)
  const link = target ? parseWorkspaceLink(target) : null
  const linkClassName = cn(
    'larify-message-link inline-flex max-w-full cursor-pointer items-baseline border-0 bg-transparent p-0 align-baseline font-inherit text-blue-500 no-underline transition-colors hover:text-blue-400',
    className
  )
  const content = <span className="min-w-0 break-all">{children}</span>

  if (target && link?.kind === 'file') {
    return (
      <button
        aria-label={rest['aria-label']}
        className={linkClassName}
        id={rest.id}
        onClick={(event) => {
          event.preventDefault()
          // 必须传 parseWorkspaceLink **解码后**的 link.target：原始 href 里的中文等
          // 非 ASCII 已被 Markdown 渲染器做百分号编码（如 `功能` → `%E5%8A%9F...`），
          // 若直接把原始 href 当路径去 stat 会命中不存在的文件（ENOENT），链接点不开。
          onOpenLink?.({ kind: 'file', target: link.target })
        }}
        tabIndex={rest.tabIndex}
        title={rest.title}
        type="button"
      >
        {content}
      </button>
    )
  }

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (target && link?.kind === 'url') {
      event.preventDefault()
      onOpenLink?.({ kind: 'url', target: link.url })
      return
    }
    if (link?.kind === 'anchor') {
      // 锚点滚动交由外部（onClick）处理；默认导航会改写 window.location.hash，
      // 在消息正文等无标题 id 的上下文会污染全局 hash 而无任何滚动效果。
      event.preventDefault()
      onClick?.(event)
    }
  }

  return (
    <a
      {...rest}
      className={linkClassName}
      href={link?.kind === 'url' || link?.kind === 'anchor' ? target : undefined}
      onClick={handleClick}
    >
      {content}
    </a>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function createMessageLink(
  onOpenLink: MessageLinkHandler
): (props: MessageLinkProps) => React.JSX.Element {
  function BoundMessageLink(props: MessageLinkProps): React.JSX.Element {
    return <MessageLink {...props} onOpenLink={onOpenLink} />
  }
  return BoundMessageLink
}
