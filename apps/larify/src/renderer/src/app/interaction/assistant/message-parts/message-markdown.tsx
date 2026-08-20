import { useMemo } from 'react'
import { defaultRehypePlugins } from 'streamdown'
import {
  MessageResponse,
  type MessageResponseProps
} from '@renderer/components/ai-elements/message'
import { createMessageLink, MessageLink } from '@renderer/components/ai-elements/message-link'
import { useMessageLinkHandler } from '../message-links'

const transformWorkspaceUrl = (url: string, key: string): string | null => {
  const normalized = url.toLowerCase()
  return key === 'src' && normalized.startsWith('data:') && !normalized.startsWith('data:image/')
    ? null
    : url
}

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

export function MessageMarkdown({
  children,
  isAnimating
}: {
  children: string
  isAnimating: boolean
}): React.JSX.Element {
  const messageLinkHandler = useMessageLinkHandler()
  const components = useMemo(
    () => ({ a: messageLinkHandler ? createMessageLink(messageLinkHandler) : MessageLink }),
    [messageLinkHandler]
  )
  return (
    <MessageResponse
      components={components}
      isAnimating={isAnimating}
      rehypePlugins={workspaceLinkRehypePlugins}
      urlTransform={transformWorkspaceUrl}
    >
      {children}
    </MessageResponse>
  )
}
