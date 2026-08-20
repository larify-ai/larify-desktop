import { isFileUIPart, isToolUIPart, type UIMessage } from 'ai'
import { Message, MessageContent } from '@renderer/components/ai-elements/message'
import { FileAttachments } from './message-parts/file-attachments'
import { MessagePart } from './message-parts/message-part'
import { isVisibleToolPart } from './message-parts/tool-visibility'
import { UserMessageContent } from './message-parts/user-message-content'
import { summarizeMessageChanges } from './change-summary'
import { ChangesSummaryCard } from './changes-summary-card'

export function MessageView({
  message,
  streaming = false
}: {
  message: UIMessage
  streaming?: boolean
}): React.JSX.Element | null {
  const files = message.parts.filter(isFileUIPart)
  const changeSummary = message.role === 'assistant' ? summarizeMessageChanges(message) : null
  const hasContent = message.parts.some(
    (part) =>
      (part.type === 'text' && Boolean(part.text)) ||
      (part.type === 'reasoning' && Boolean(part.text)) ||
      (isToolUIPart(part) && isVisibleToolPart(part))
  )
  if (!files.length && !hasContent && !changeSummary) return null

  const lastStreamingIndex = message.parts.findLastIndex(
    (part) => (part.type === 'text' || part.type === 'reasoning') && Boolean(part.text)
  )
  const content = message.parts.map((part, index) => {
    if (isFileUIPart(part)) return null
    const id = `${message.id}-${index}`
    return (
      <MessagePart key={id} part={part} streaming={streaming && index === lastStreamingIndex} />
    )
  })

  return (
    <Message from={message.role}>
      {files.length ? <FileAttachments files={files} messageId={message.id} /> : null}
      {message.role === 'user' ? (
        hasContent ? (
          <UserMessageContent>{content}</UserMessageContent>
        ) : null
      ) : hasContent || changeSummary ? (
        <MessageContent className="select-text break-words [overflow-wrap:anywhere]">
          {content}
          {changeSummary ? <ChangesSummaryCard {...changeSummary} /> : null}
        </MessageContent>
      ) : null}
    </Message>
  )
}
