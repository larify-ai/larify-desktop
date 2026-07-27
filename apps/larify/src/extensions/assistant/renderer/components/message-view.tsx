import { getToolName, isFileUIPart, isToolUIPart, type FileUIPart, type UIMessage } from "ai"
import { Message, MessageContent, MessageResponse } from "@renderer/components/ai-elements/message"
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react"
import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
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
import { ChangesSummaryCard } from "./changes-summary-card"
import { asDiffMeta, toolCall, toolIcon } from "../lib/diff-meta"
import { summarizeMessageChanges } from "../lib/change-summary"

const debugToolErrors = import.meta.env.VITE_LARIFY_DEBUG_TOOL_ERRORS === "1"

function UserMessageContent({ children }: { children: ReactNode }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || expanded) return
    const measure = (): void => {
      const next = content.scrollHeight > content.clientHeight + 1
      setOverflowing((current) => (current === next ? current : next))
    }
    measure()
    window.addEventListener("resize", measure)
    window.addEventListener("pointerup", measure)
    return () => {
      window.removeEventListener("resize", measure)
      window.removeEventListener("pointerup", measure)
    }
  }, [children, expanded])

  return (
    <div className="ml-auto w-fit max-w-full">
      <MessageContent className="select-text">
        <div
          ref={contentRef}
          className={expanded ? "" : "max-h-[3.75rem] overflow-hidden"}
        >
          {children}
        </div>
      </MessageContent>
      {overflowing && (
        <button
          type="button"
          aria-label={expanded ? "收起消息" : "展开消息"}
          className="mt-1 ml-auto flex w-fit items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
          {expanded ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
        </button>
      )}
    </div>
  )
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
}: {
  message: UIMessage
  streaming?: boolean
}): React.JSX.Element {
  const hasText = message.parts.some((p) => p.type === "text")
  const files = message.parts.filter(isFileUIPart)
  const changeSummary =
    message.role === "assistant" && !streaming ? summarizeMessageChanges(message) : null
  const content = message.parts.map((part, i) => {
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
        const toolMeta = asDiffMeta(part.output)
        const icon = toolIcon(part.toolMetadata)
        const { title, args } = toolCall(part.input)
        if (!title) return null
        const toolName = getToolName(part)
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
  })

  return (
    <Message from={message.role}>
      {files.length > 0 ? <FileGroup files={files} messageId={message.id} /> : null}
      {message.role === "user" ? (
        <UserMessageContent>{content}</UserMessageContent>
      ) : (
        <MessageContent className="select-text">
          {content}
          {changeSummary ? (
            <ChangesSummaryCard {...changeSummary} className="mt-3" />
          ) : null}
        </MessageContent>
      )}
    </Message>
  )
}
