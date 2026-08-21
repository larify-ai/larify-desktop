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
}

function nodeHref(node: unknown): string | undefined {
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
  ...rest
}: MessageLinkProps): React.JSX.Element {
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
          onOpenLink?.({ kind: 'file', target })
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
    if (link?.kind === 'anchor') onClick?.(event)
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
): (props: ComponentProps<'a'>) => React.JSX.Element {
  function BoundMessageLink(props: ComponentProps<'a'>): React.JSX.Element {
    return <MessageLink {...props} onOpenLink={onOpenLink} />
  }
  return BoundMessageLink
}
