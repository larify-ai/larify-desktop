import { isToolUIPart, type UIMessage } from 'ai'
import { MessageMarkdown } from './message-markdown'
import { ReasoningPart } from './reasoning-part'
import { ToolPart } from './tool-part'

type Part = UIMessage['parts'][number]

export function MessagePart({
  part,
  streaming
}: {
  part: Part
  streaming: boolean
}): React.JSX.Element | null {
  if (part.type === 'text') {
    const isStreaming = part.state === 'streaming' || (part.state === undefined && streaming)
    return part.text ? (
      <MessageMarkdown isAnimating={isStreaming}>{part.text}</MessageMarkdown>
    ) : null
  }
  if (part.type === 'reasoning') return <ReasoningPart part={part} streaming={streaming} />
  if (isToolUIPart(part)) return <ToolPart part={part} />
  return null
}
