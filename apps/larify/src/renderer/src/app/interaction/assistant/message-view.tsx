import { isFileUIPart, isToolUIPart, type UIMessage } from 'ai'
import { Message, MessageContent } from '@renderer/components/ai-elements/message'
import { FileAttachments } from './message-parts/file-attachments'
import { MessagePart } from './message-parts/message-part'
import { UserMessageContent } from './message-parts/user-message-content'

export function MessageView({
  message,
  streaming = false
}: {
  message: UIMessage
  streaming?: boolean
}): React.JSX.Element | null {
  const files = message.parts.filter(isFileUIPart)
  const hasContent = message.parts.some(
    (part) =>
      (part.type === 'text' && Boolean(part.text)) ||
      (part.type === 'reasoning' && Boolean(part.text)) ||
      isToolUIPart(part)
  )
  if (!files.length && !hasContent) return null

  const content = message.parts.map((part, index) => {
    if (isFileUIPart(part)) return null
    const id = `${message.id}-${index}`
    const isLast = index === message.parts.length - 1
    return <MessagePart key={id} part={part} streaming={streaming && isLast} />
  })

  return (
    <Message from={message.role}>
      {files.length ? <FileAttachments files={files} messageId={message.id} /> : null}
      {hasContent ? (
        message.role === 'user' ? (
          <UserMessageContent>{content}</UserMessageContent>
        ) : (
          <MessageContent className="select-text break-words [overflow-wrap:anywhere]">
            {content}
          </MessageContent>
        )
      ) : null}
    </Message>
  )
}
