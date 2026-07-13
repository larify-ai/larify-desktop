import type { UIMessage } from "ai"
import { Message, MessageContent, MessageResponse } from "@renderer/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@renderer/components/ai-elements/reasoning"

export function MessageView({
  message,
  streaming = false,
}: {
  message: UIMessage
  streaming?: boolean
}): React.JSX.Element {
  const hasText = message.parts.some((p) => p.type === "text")
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          if (part.type === "text") return <MessageResponse key={i}>{part.text}</MessageResponse>
          if (part.type === "reasoning")
            return (
              <Reasoning key={i} isStreaming={streaming && !hasText}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            )
          return null
        })}
      </MessageContent>
    </Message>
  )
}
