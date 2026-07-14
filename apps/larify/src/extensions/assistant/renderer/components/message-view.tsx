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
import { FileDiff, type DiffMeta } from "./file-diff"

function asDiffMeta(data: unknown): DiffMeta | null {
  return data && typeof data === "object" && (data as DiffMeta).kind === "diff"
    ? (data as DiffMeta)
    : null
}

function unwrapToolDisplay(
  toolName: string,
  input: unknown,
): { toolName: string; input: unknown } | null {
  const maybeCallToolInput = input as { name?: unknown; args?: unknown } | null
  if (
    toolName === "call_tool" &&
    maybeCallToolInput &&
    typeof maybeCallToolInput === "object" &&
    typeof maybeCallToolInput.name === "string" &&
    "args" in maybeCallToolInput
  ) {
    return {
      toolName: maybeCallToolInput.name,
      input: maybeCallToolInput.args,
    }
  }
  if (toolName === "call_tool") return null
  return { toolName, input }
}

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
          if (part.type === "data-tool-meta") {
            const meta = asDiffMeta((part as { data?: unknown }).data)
            return meta ? <FileDiff key={i} meta={meta} /> : null
          }
          if (isToolUIPart(part))
            {
              const display = unwrapToolDisplay(getToolName(part), part.input)
              if (!display) return null
              return (
                <Tool key={i}>
                  <ToolHeader type="dynamic-tool" toolName={display.toolName} state={part.state} />
                  <ToolContent>
                    <ToolInput input={display.input} />
                    <ToolOutput output={part.output} errorText={part.errorText} />
                  </ToolContent>
                </Tool>
              )
            }
          return null
        })}
      </MessageContent>
    </Message>
  )
}
