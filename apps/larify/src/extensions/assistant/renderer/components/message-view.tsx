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
import { FileDiff } from "./file-diff"
import { asDiffMeta, toolCall, toolIcon } from "../lib/diff-meta"

const debugToolErrors = import.meta.env.VITE_LARIFY_DEBUG_TOOL_ERRORS === "1"

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
}: {
  message: UIMessage
  streaming?: boolean
}): React.JSX.Element {
  const hasText = message.parts.some((p) => p.type === "text")
  const files = message.parts.filter(isFileUIPart)

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
          if (isToolUIPart(part))
            {
              const toolName = getToolName(part)
              const toolMeta = asDiffMeta(part.output)
              const icon = toolIcon(part.toolMetadata)
              const { title, args } = toolCall(part.input)
              const showErrorAsOutput = part.state === "output-error" && !debugToolErrors
              const state = showErrorAsOutput ? "output-available" : part.state
              const output = showErrorAsOutput ? part.errorText : part.output
              const errorText = showErrorAsOutput ? undefined : part.errorText
              return (
                <Tool key={i}>
                  <ToolHeader type="dynamic-tool" toolName={toolName} title={title} icon={icon} state={state} />
                  <ToolContent>
                    {toolMeta ? (
                      <FileDiff meta={toolMeta} />
                    ) : (
                      <>
                        <ToolInput input={{ name: toolName, args }} />
                        <ToolOutput output={output} errorText={errorText} />
                      </>
                    )}
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
