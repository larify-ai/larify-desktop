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

export type ToolDisplayMeta = {
  title?: string
  icon?: string
  defaultOpen?: boolean
  hideRawDetails?: boolean
}

function asDiffMeta(data: unknown): DiffMeta | null {
  return data && typeof data === "object" && (data as DiffMeta).kind === "diff"
    ? (data as DiffMeta)
    : null
}

function asToolInvocationArgs(value: unknown): { name: string; args: unknown } | null {
  if (!value || typeof value !== "object") return null
  const candidate = value as { name?: unknown; args?: unknown }
  return typeof candidate.name === "string" && "args" in candidate
    ? { name: candidate.name, args: candidate.args }
    : null
}

function unwrapToolDisplay(
  toolName: string,
  input: unknown,
): { toolName: string; input: unknown; title?: string } | null {
  const maybeCallToolInput = input as {
    title?: unknown
    args?: {
      name?: unknown
      args?: unknown
    }
  } | null
  const maybeInnerArgs = asToolInvocationArgs(maybeCallToolInput?.args)
  if (
    toolName === "call_tool" &&
    maybeCallToolInput &&
    typeof maybeCallToolInput === "object" &&
    maybeInnerArgs
  ) {
    return {
      toolName: maybeInnerArgs.name,
      input: maybeInnerArgs.args,
      ...(typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
    }
  }
  if (toolName === "call_tool") return null
  return {
    toolName,
    input:
      maybeCallToolInput &&
      typeof maybeCallToolInput === "object" &&
      "args" in maybeCallToolInput
        ? maybeCallToolInput.args
        : input,
    ...(maybeCallToolInput &&
      typeof maybeCallToolInput === "object" &&
      typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
  }
}

export function MessageView({
  message,
  streaming = false,
  toolDisplays = {},
}: {
  message: UIMessage
  streaming?: boolean
  toolDisplays?: Record<string, ToolDisplayMeta>
}): React.JSX.Element {
  const hasText = message.parts.some((p) => p.type === "text")
  const toolMetaById = new Map<string, DiffMeta>()

  for (const part of message.parts) {
    if (part.type !== "data-tool-meta") continue
    const data = (part as { data?: unknown }).data
    const meta = asDiffMeta(data)
    const id = (part as { id?: unknown }).id
    if (typeof id !== "string") continue
    if (meta) toolMetaById.set(id, meta)
  }

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
          if (part.type === "data-tool-meta") return null
          if (isToolUIPart(part))
            {
              const display = unwrapToolDisplay(getToolName(part), part.input)
              if (!display) return null
              const toolMeta = toolMetaById.get(part.toolCallId)
              const toolDisplay = toolDisplays[display.toolName]
              const showRawToolDetails = Boolean(part.errorText) || !toolDisplay?.hideRawDetails
              return (
                <Tool key={i} defaultOpen={toolDisplay?.defaultOpen}>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName={display.toolName}
                    title={display.title ?? toolDisplay?.title}
                    icon={toolDisplay?.icon}
                    state={part.state}
                  />
                  <ToolContent>
                    {toolMeta ? <FileDiff meta={toolMeta} /> : null}
                    {showRawToolDetails ? (
                      <>
                        <ToolInput input={display.input} />
                        <ToolOutput output={part.output} errorText={part.errorText} />
                      </>
                    ) : null}
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
