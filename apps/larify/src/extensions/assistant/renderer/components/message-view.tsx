import { getToolName, isToolUIPart, type UIMessage } from "ai"
import { Message, MessageContent, MessageResponse } from "@renderer/components/ai-elements/message"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@renderer/components/ai-elements/reasoning"
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@renderer/components/ai-elements/tool"

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
      <MessageContent className="select-text">
        {message.parts.map((part, i) => {
          if (part.type === "text") return <MessageResponse key={i}>{part.text}</MessageResponse>
          if (part.type === "reasoning")
            return (
              <Reasoning key={i} isStreaming={streaming && !hasText}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            )
          if (isToolUIPart(part))
            return (
              <Tool key={i}>
                <ToolHeader type="dynamic-tool" toolName={getToolName(part)} state={part.state} />
                <ToolContent>
                  <ToolInput input={part.input} />
                  <ToolOutput output={part.output} errorText={part.errorText} />
                </ToolContent>
              </Tool>
            )
          return null
        })}
      </MessageContent>
    </Message>
  )
}
