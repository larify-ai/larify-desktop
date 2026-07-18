import { getToolName, isFileUIPart, isToolUIPart, type FileUIPart, type UIMessage } from "ai"
import { Message, MessageContent, MessageResponse } from "@renderer/components/ai-elements/message"
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from "@renderer/components/ai-elements/attachments"
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
}

function asDiffMeta(data: unknown): DiffMeta | null {
  return data && typeof data === "object" && (data as DiffMeta).kind === "diff"
    ? (data as DiffMeta)
    : null
}

function unwrapToolDisplay(
  toolName: string,
  input: unknown,
): { toolName: string; input: unknown; title?: string } | null {
  const maybeCallToolInput = input as {
    title?: unknown
    tool_name?: unknown
    tool_args?: unknown
  } | null
  if (
    toolName === "call_tool" &&
    maybeCallToolInput &&
    typeof maybeCallToolInput === "object" &&
    typeof maybeCallToolInput.tool_name === "string"
  ) {
    return {
      toolName: maybeCallToolInput.tool_name,
      input: maybeCallToolInput.tool_args,
      ...(typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
    }
  }
  if (toolName === "call_tool") {
    return {
      toolName,
      input,
      ...(maybeCallToolInput &&
        typeof maybeCallToolInput === "object" &&
        typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
    }
  }
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

function FileGroup({
  files,
  messageId,
}: {
  files: FileUIPart[]
  messageId: string
}): React.JSX.Element {
  return (
    <Attachments variant="inline" className="group-[.is-user]:ml-auto group-[.is-user]:justify-end">
      {files.map((file, index) => (
        <Attachment data={{ ...file, id: `${messageId}-${index}` }} key={`${messageId}-${index}`}>
          <AttachmentPreview />
          <AttachmentInfo />
        </Attachment>
      ))}
    </Attachments>
  )
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
  const files = message.parts.filter(isFileUIPart)
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
      {files.length > 0 ? <FileGroup files={files} messageId={message.id} /> : null}
      <MessageContent className="select-text">
        {message.parts.map((part, i) => {
          if (isFileUIPart(part)) return null
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
              const showRawToolDetails = Boolean(part.errorText) || !toolMeta
              return (
                <Tool key={i} defaultOpen={Boolean(toolMeta)}>
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
