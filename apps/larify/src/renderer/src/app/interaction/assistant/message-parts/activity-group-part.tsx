import { useEffect, useRef, useState } from 'react'
import { BrainIcon, ChevronRightIcon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import type { UIMessage } from 'ai'
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
    return (
      (part?.type === 'text' || part?.type === 'reasoning') &&
      (part.state === 'streaming' || (part.state === undefined && index === fallbackStreamingIndex))
    )
  })
}

export function ActivityGroupPart({
  item,
  message,
  streaming,
  summaryIcon,
  summaryClassName,
  initialOpen,
  onOpenChange,
  additionalContent,
  contentOnly = false
}: {
  item: AssistantRenderItem
  message: UIMessage
  streaming: boolean
  summaryIcon?: React.ReactNode
  summaryClassName?: string
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
  additionalContent?: React.ReactNode
  contentOnly?: boolean
}): React.JSX.Element | null {
  const [open, setOpen] = useState(initialOpen ?? item.defaultOpen)
  const wasDefaultOpen = useRef(item.defaultOpen)
  useEffect(() => {
    if (wasDefaultOpen.current !== item.defaultOpen) setOpen(item.defaultOpen)
    wasDefaultOpen.current = item.defaultOpen
  }, [item.defaultOpen])
  const meta = message.metadata as Record<string, unknown> | undefined
  const totalProcessingMs =
    typeof meta?.totalProcessingMs === 'number' && Number.isFinite(meta.totalProcessingMs)
      ? meta.totalProcessingMs
      : 0
  const summary =
    !summaryIcon && streaming && item.startedAt !== undefined ? (
      <LiveProcessingDuration
        key={item.startedAt}
        startedAt={item.startedAt}
        baseMs={totalProcessingMs}
      />
    ) : (
      item.summary
    )
  const isGroup = item.kind === 'activity-group'
  const indexedParts = item.partIndexes.flatMap((index) => {
    const part = message.parts[index]
    return part ? [{ index, part }] : []
  })
  const fallbackStreamingIndex = streaming ? message.parts.findLastIndex(hasVisibleTextPart) : -1
  if (item.kind === 'status') {
    return (
      <div>
        <div className="text-sm text-muted-foreground">{summary}</div>
        {item.startedAt === undefined ? <div className="mt-2 h-px bg-border" /> : null}
      </div>
    )
  }
  if (!indexedParts.length) return null
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
        <ReasoningBody key={index} data-reasoning-content className="text-foreground">
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
        setOpen(nextOpen)
      }}
      className="not-prose min-w-0"
    >
      <CollapsibleTrigger
        className={cn(
          'group/summary flex w-full min-w-0 cursor-pointer select-none items-center gap-x-2 text-sm',
          isGroup ? 'flex-wrap gap-y-3' : 'flex-nowrap',
          summaryClassName ?? (isGroup ? 'text-muted-foreground' : 'text-foreground')
        )}
      >
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
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 transition-[opacity,transform]',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/summary:opacity-100'
          )}
        />
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
}
