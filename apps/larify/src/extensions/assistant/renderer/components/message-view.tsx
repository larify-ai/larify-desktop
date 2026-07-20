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

const debugToolCardsOpen = import.meta.env.VITE_LARIFY_DEBUG_TOOL_CARDS_OPEN === "1"
const debugToolErrors = import.meta.env.VITE_LARIFY_DEBUG_TOOL_ERRORS === "1"

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
): { toolName: string; input: unknown; title?: string; inputIsOuterToolArgs?: boolean } | null {
  const maybeCallToolInput = input as {
    title?: unknown
    name?: unknown
    args?: unknown
  } | null
  if (
    toolName === "call_tool" &&
    maybeCallToolInput &&
    typeof maybeCallToolInput === "object" &&
    typeof maybeCallToolInput.name === "string"
  ) {
    return {
      toolName: maybeCallToolInput.name,
      input: maybeCallToolInput.args,
      ...(typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
    }
  }
  if (toolName === "call_tool") {
    return {
      toolName,
      input,
      inputIsOuterToolArgs: true,
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
    inputIsOuterToolArgs: true,
    ...(maybeCallToolInput &&
      typeof maybeCallToolInput === "object" &&
      typeof maybeCallToolInput.title === "string" && { title: maybeCallToolInput.title }),
  }
}

function toolInputDisplay(toolName: string, input: unknown): Record<string, unknown> {
  return {
    name: toolName,
    args: input,
  }
}

function outerToolInputDisplay(toolName: string, input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input) && "title" in input) {
    const { title: _title, ...toolArgs } = input as Record<string, unknown>
    return {
      name: toolName,
      args: toolArgs,
    }
  }
  return {
    name: toolName,
    args: input,
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

const emptyToolDisplays: Record<string, ToolDisplayMeta> = {}

export function MessageView({
  message,
  streaming = false,
  toolDisplays = emptyToolDisplays,
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
              const showErrorAsOutput = part.state === "output-error" && !debugToolErrors
              const state = showErrorAsOutput ? "output-available" : part.state
              const output = showErrorAsOutput ? part.errorText : part.output
              const errorText = showErrorAsOutput ? undefined : part.errorText
              const showRawOutput = Boolean(errorText) || Boolean(output) || !toolMeta
              return (
                <Tool key={i} defaultOpen={debugToolCardsOpen || Boolean(toolMeta)}>
                  <ToolHeader
                    type="dynamic-tool"
                    toolName={display.toolName}
                    title={display.title ?? toolDisplay?.title}
                    icon={toolDisplay?.icon}
                    state={state}
                  />
                  <ToolContent>
                    <ToolInput
                      input={
                        display.inputIsOuterToolArgs
                          ? outerToolInputDisplay(display.toolName, display.input)
                          : toolInputDisplay(display.toolName, display.input)
                      }
                    />
                    {toolMeta ? <FileDiff meta={toolMeta} /> : null}
                    {showRawOutput ? <ToolOutput output={output} errorText={errorText} /> : null}
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
