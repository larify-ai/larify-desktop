import { isToolUIPart, type UIMessage } from 'ai'
import { MessageResponse } from '@renderer/components/ai-elements/message'
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
  if (part.type === 'text') return part.text ? <MessageResponse>{part.text}</MessageResponse> : null
  if (part.type === 'reasoning') return <ReasoningPart part={part} streaming={streaming} />
  if (isToolUIPart(part)) return <ToolPart part={part} />
  return null
}
