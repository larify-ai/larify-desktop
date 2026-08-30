import { useMemo } from 'react'
import {
  MessageResponse
} from '@renderer/components/ai-elements/message'
import { createMessageLink, MessageLink } from '@renderer/components/ai-elements/message-link'
import { normalizeModelMarkdownLinks } from '@renderer/lib/model-markdown-links'
import {
  transformWorkspaceUrl,
  workspaceLinkRehypePlugins
} from '@renderer/lib/workspace-markdown-plugins'
import { useMessageLinkHandler } from '../message-links'

export function MessageMarkdown({
  children,
  isAnimating,
  className
}: {
  children: string
  isAnimating: boolean
  className?: string
}): React.JSX.Element {
  const messageLinkHandler = useMessageLinkHandler()
  const components = useMemo(
    () => ({ a: messageLinkHandler ? createMessageLink(messageLinkHandler) : MessageLink }),
    [messageLinkHandler]
  )
  const markdown = useMemo(() => normalizeModelMarkdownLinks(children), [children])
  return (
    <MessageResponse
      className={className}
      components={components}
      isAnimating={isAnimating}
      mode={isAnimating ? 'streaming' : 'static'}
      rehypePlugins={workspaceLinkRehypePlugins}
      urlTransform={transformWorkspaceUrl}
    >
      {markdown}
    </MessageResponse>
  )
}
