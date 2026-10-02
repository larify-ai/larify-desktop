import { memo } from 'react'
import { BrainIcon, ChevronRightIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { isToolUIPart, type UIMessage } from 'ai'
import {
  hasVisibleTextPart,
  type AssistantRenderItem,
  type AssistantRenderItemKind
} from '../message-render-items'
import { LiveProcessingDuration } from '../live-processing-duration'
import { MessagePart } from './message-part'
import { MessageMarkdown } from './message-markdown'
import { ToolIcon } from '@renderer/components/ai-elements/tool'
import { ReasoningBody } from '@renderer/components/ai-elements/reasoning'
import { cn } from '@renderer/lib/utils'
import { ActivityShimmer } from './activity-shimmer'
import { activityGroupPropsEqual, type ActivityGroupPartProps } from './activity-group-memo'
import { useStickyOpen } from './use-sticky-open'

const icons: Partial<Record<AssistantRenderItemKind, LucideIcon>> = {
  reasoning: BrainIcon,
  'intermediate-text': BrainIcon
}

function SummaryIcon({ item }: { item: AssistantRenderItem }): React.JSX.Element {
  const source = item.kind === 'activity-group' ? (item.children?.at(-1) ?? item) : item
  const Icon = icons[source.kind]
  return Icon ? (
    <Icon className="size-4 shrink-0" />
  ) : (
    <ToolIcon kind={source.icon} className="size-4 shrink-0" />
  )
}

function isStreamingChild(
  item: AssistantRenderItem,
  message: UIMessage,
  fallbackStreamingIndex: number
): boolean {
  return item.partIndexes.some((index) => {
    const part = message.parts[index]
    if (!part) return false
    if (part.type === 'text' || part.type === 'reasoning') {
      return (
        part.state === 'streaming' || (part.state === undefined && index === fallbackStreamingIndex)
      )
    }
    // 工具在执行中（参数流式/运行中输出流式）也视为活跃，让处理列表条目标题扫光；
    // output-available/error/denied 等完成后不再扫光。
    if (isToolUIPart(part)) {
      return part.state === 'input-streaming' || part.state === 'input-available'
    }
    return false
  })
}

export const ActivityGroupPart = memo(function ActivityGroupPart({
  item,
  message,
  streaming,
  summaryIcon,
  summaryClassName,
  initialOpen,
  onOpenChange,
  additionalContent,
  contentOnly = false,
  active = true
}: ActivityGroupPartProps): React.JSX.Element | null {
  const [open, setOpenSticky] = useStickyOpen(initialOpen, item.defaultOpen)
  const meta = message.metadata as Record<string, unknown> | undefined
  const totalProcessingMs =
    typeof meta?.totalProcessingMs === 'number' && Number.isFinite(meta.totalProcessingMs)
      ? meta.totalProcessingMs
      : 0
  const isGroup = item.kind === 'activity-group'
  const summary =
    !summaryIcon && streaming && isGroup ? (
      <LiveProcessingDuration
        startedAt={item.startedAt}
        baseMs={totalProcessingMs}
        active={active}
      />
    ) : (
      item.summary
    )
  const indexedParts = item.partIndexes.flatMap((index) => {
    const part = message.parts[index]
    return part ? [{ index, part }] : []
  })
  const fallbackStreamingIndex = streaming ? message.parts.findLastIndex(hasVisibleTextPart) : -1
  const collapsible = Boolean(item.children?.length) || indexedParts.length > 0
  if (!collapsible && !isGroup) return null
  const content = item.children
    ? item.children.map((child) => (
        <ActivityGroupPart
          key={`${child.kind}-${child.partIndexes.join('-')}`}
          item={child}
          message={message}
          streaming={streaming && isStreamingChild(child, message, fallbackStreamingIndex)}
        />
      ))
    : indexedParts.map(({ index, part }, position) =>
        part.type === 'reasoning' || (part.type === 'text' && item.kind === 'intermediate-text') ? (
          <ReasoningBody
            key={index}
            data-reasoning-content
            className="max-h-[20rem] overflow-y-auto overscroll-contain text-foreground"
          >
            <MessageMarkdown isAnimating={streaming && position === indexedParts.length - 1}>
              {part.text}
            </MessageMarkdown>
          </ReasoningBody>
        ) : (
          <MessagePart
            key={index}
            part={part}
            streaming={streaming && position === indexedParts.length - 1}
          />
        )
      )
  if (contentOnly) return <div className="flex flex-col gap-3">{content}</div>
  return (
    <Collapsible
      data-activity-group
      data-activity-kind={item.kind}
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen)
        setOpenSticky(nextOpen)
      }}
      className="not-prose min-w-0"
    >
      <CollapsibleTrigger
        disabled={!collapsible}
        className={cn(
          'group/summary flex w-full min-w-0 select-none items-center gap-x-2 text-sm',
          // 外层必须保留 flex-wrap：isGroup 时分隔线靠 order-last + basis-full 独占一行。
          isGroup ? 'flex-wrap gap-y-3' : 'flex-nowrap',
          collapsible && 'cursor-pointer',
          summaryClassName ?? (isGroup ? 'text-muted-foreground' : 'text-foreground')
        )}
      >
        {/* 图标/标题/箭头单独包一层 flex-nowrap：长标题只截断自身，不会把箭头挤到下一行。 */}
        <span className="flex w-full min-w-0 items-center gap-x-2">
          {streaming && !isGroup ? (
            <>
              {summaryIcon ?? <SummaryIcon item={item} />}
              <ActivityShimmer className="min-w-0 text-foreground">
                <span className="min-w-0 truncate">
                  {summary || (item.kind === 'reasoning' ? '思考' : '处理中')}
                </span>
              </ActivityShimmer>
            </>
          ) : (
            <>
              {summaryIcon ?? (isGroup ? null : <SummaryIcon item={item} />)}
              <span className="min-w-0 truncate">
                {summary || (item.kind === 'reasoning' ? '思考' : '处理中')}
              </span>
            </>
          )}
          {collapsible ? (
            <ChevronRightIcon
              className={cn(
                'size-3.5 shrink-0 transition-[opacity,transform]',
                open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/summary:opacity-100'
              )}
            />
          ) : null}
        </span>
        {isGroup && !summaryIcon ? (
          <span className="order-last h-px w-full basis-full bg-border" />
        ) : null}
      </CollapsibleTrigger>
      {open ? (
        <CollapsibleContent className="mt-3 flex flex-col gap-3">
          {content}
          {additionalContent}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}, activityGroupPropsEqual)
