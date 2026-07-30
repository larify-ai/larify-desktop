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
}): React.JSX.Element | null {
  const files = message.parts.filter(isFileUIPart)
  const changeSummary =
    message.role === "assistant" && !streaming ? summarizeMessageChanges(message) : null
  const content = message.parts.map((part, i) => {
    if (isFileUIPart(part)) return null
    if (part.type === "text")
      return part.text ? <MessageResponse key={i}>{part.text}</MessageResponse> : null
    if (part.type === "reasoning") {
      if (!part.text) return null
      const isReasoningStreaming =
        part.state === "streaming" ||
        (part.state === undefined && streaming && i === message.parts.length - 1)
      return (
        <Reasoning key={i} isStreaming={isReasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{part.text}</ReasoningContent>
        </Reasoning>
      )
    }
    if (isToolUIPart(part))
      {
        const toolMeta = asDiffMeta(part.output)
        const icon = toolIcon(part.toolMetadata)
        const { title, args } = toolCall(part.input)
        if (!title) return null
        const toolName = getToolName(part)
        return (
          <Tool key={i}>
            <ToolHeader type="dynamic-tool" toolName={toolName} title={title} icon={icon} state={part.state} />
            <ToolContent>
              {toolMeta ? (
                <FileDiff meta={toolMeta} />
              ) : (
                <>
                  <ToolInput input={{ name: toolName, args }} />
                  <ToolOutput output={part.output} errorText={part.errorText} />
                </>
              )}
            </ToolContent>
          </Tool>
        )
      }
    return null
  })

  if (files.length === 0 && content.every((part) => part === null)) return null

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
