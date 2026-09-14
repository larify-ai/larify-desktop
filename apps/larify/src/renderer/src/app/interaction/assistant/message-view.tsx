import { isFileUIPart, isToolUIPart, type UIMessage } from 'ai'
import { Message, MessageContent } from '@renderer/components/ai-elements/message'
import { FileAttachments } from './message-parts/file-attachments'
import { MessagePart } from './message-parts/message-part'
import { isVisibleToolPart } from './message-parts/tool-visibility'
import { UserMessageContent } from './message-parts/user-message-content'
import { summarizeMessageChanges } from './change-summary'
import { ChangesSummaryCard } from './changes-summary-card'
import {
  hasVisibleTextPart,
  isActivityRenderItem,
  type AssistantRenderItem
} from './message-render-items'
import { ActivityGroupPart } from './message-parts/activity-group-part'
import { cn } from '@renderer/lib/utils'

export function MessageView({
  message,
  streaming = false,
  renderItem,
  activityKey,
  activityOpen,
  onActivityOpenChange,
  firstFragment = true,
  lastFragment = true,
  hideChanges = false,
  replayFinal = false,
  onFinalReplayComplete,
  active = true
}: {
  message: UIMessage
  streaming?: boolean
  renderItem?: AssistantRenderItem
  activityKey?: string
  activityOpen?: boolean
  onActivityOpenChange?: (key: string, open: boolean) => void
  firstFragment?: boolean
  lastFragment?: boolean
  hideChanges?: boolean
  replayFinal?: boolean
  onFinalReplayComplete?: () => void
  active?: boolean
}): React.JSX.Element | null {
  const files = firstFragment ? message.parts.filter(isFileUIPart) : []
  const changeSummary =
    !hideChanges && lastFragment && message.role === 'assistant'
      ? summarizeMessageChanges(message)
      : null
  const selectedParts = renderItem
    ? renderItem.partIndexes.map((index) => message.parts[index])
    : message.parts
  const hasContent =
    renderItem?.kind === 'status' ||
    selectedParts.some(
      (part) =>
        part !== undefined &&
        (hasVisibleTextPart(part) || (isToolUIPart(part) && isVisibleToolPart(part)))
    )
  if (!files.length && !hasContent && !changeSummary) return null

  const lastStreamingIndex = message.parts.findLastIndex(hasVisibleTextPart)
  // 实测(sessions.db: 1192 条 assistant 消息 / 12462 个 text part)：
  // 一个消息的 final-text 区间内几乎总是恰好 1 个 text part（末尾活动之后再到下一个活动之前）。
  // 故不再把多个 text part 用 '' 拼接（拼接会在无分隔符时把两段文字首尾粘连），
  // 直接取最后一个非空 text part 作为最终答案。
  const finalText =
    renderItem?.kind === 'final-text'
      ? selectedParts
          .filter((part): part is Extract<typeof part, { type: 'text' }> => part?.type === 'text')
          .filter((part) => part.text.trim())
          .at(-1)?.text
      : undefined
  // 用户消息正文：同样不拼接，取最后一个非空 text part（一条用户消息通常只有 1 个 text）。
  const userText =
    message.role === 'user'
      ? ((selectedParts
          .filter((part): part is Extract<typeof part, { type: 'text' }> => part?.type === 'text')
          .filter((part) => part.text.trim())
          .at(-1)?.text ?? '') as string)
      : ''
  const content =
    renderItem && isActivityRenderItem(renderItem)
      ? [
          <ActivityGroupPart
            key={
              activityKey ??
              `${message.id}-${renderItem.kind}-${renderItem.partIndexes[0] ?? 'activity'}`
            }
            item={renderItem}
            message={message}
            streaming={streaming}
            initialOpen={activityOpen}
            active={active}
            onOpenChange={(open) => {
              if (activityKey) onActivityOpenChange?.(activityKey, open)
            }}
          />
        ]
      : finalText !== undefined
        ? [
            <MessagePart
              key={`${message.id}-final-text`}
              part={{ type: 'text', text: finalText }}
              streaming={false}
              replay={replayFinal}
              onReplayComplete={onFinalReplayComplete}
            />
          ]
        : selectedParts.map((part, selectedIndex) => {
            if (!part) return null
            const index = renderItem?.partIndexes[selectedIndex] ?? selectedIndex
            if (isFileUIPart(part)) return null
            if (isToolUIPart(part) && !isVisibleToolPart(part)) return null
            const id = `${message.id}-${index}`
            return (
              <MessagePart
                key={id}
                part={part}
                streaming={streaming && index === lastStreamingIndex}
              />
            )
          })

  return (
    <Message from={message.role}>
      {files.length ? <FileAttachments files={files} messageId={message.id} /> : null}
      {message.role === 'user' ? (
        hasContent ? (
          <UserMessageContent text={userText}>{content}</UserMessageContent>
        ) : null
      ) : hasContent || changeSummary ? (
        <MessageContent
          className={cn(
            'select-text break-words [overflow-wrap:anywhere]',
            !lastFragment && 'mb-4'
          )}
        >
          {content}
          {changeSummary ? <ChangesSummaryCard {...changeSummary} /> : null}
        </MessageContent>
      ) : null}
    </Message>
  )
}
