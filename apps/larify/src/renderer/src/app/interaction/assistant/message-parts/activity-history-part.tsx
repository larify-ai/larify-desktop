import { CheckCircleIcon, ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import type { UIMessage } from 'ai'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { cn } from '@renderer/lib/utils'
import type { AssistantRenderItem } from '../message-render-items'
import { LiveProcessingDuration } from '../live-processing-duration'
import { formatProcessingDuration, formatProcessingDurationMs } from '../processing-duration'
import { ActivityGroupPart } from './activity-group-part'
import { useStickyOpen } from './use-sticky-open'

export interface ActivityHistorySection {
  title: string
  message: UIMessage
  item: AssistantRenderItem
  streaming: boolean
  continuations?: Array<{
    message: UIMessage
    item: AssistantRenderItem
    streaming: boolean
  }>
}

export function ActivityHistoryPart({
  sections,
  waiting = false,
  initialOpen,
  onOpenChange,
  active = true
}: {
  sections: ActivityHistorySection[]
  waiting?: boolean
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
  active?: boolean
}): React.JSX.Element {
  const defaultOpen = sections.some(({ streaming }) => streaming) || waiting
  const aborted = sections.some(
    ({ message }) =>
      message.metadata &&
      typeof message.metadata === 'object' &&
      ['aborted', 'error'].includes(String((message.metadata as Record<string, unknown>).outcome))
  )
  const metadata = (message: UIMessage | undefined): Record<string, unknown> =>
    message?.metadata && typeof message.metadata === 'object'
      ? (message.metadata as Record<string, unknown>)
      : {}
  const lastMetadata = metadata(sections.at(-1)?.message)
  // error 时透出原因（截断到一行），便于用户/开发者定位"为什么提前结束"。
  const interruptedSummary =
    lastMetadata.outcome === 'error' &&
    typeof lastMetadata.error === 'string' &&
    lastMetadata.error.trim()
      ? `已中断 · ${lastMetadata.error.trim().slice(0, 160)}`
      : '已中断'
  const startedAt = metadata(sections[0]?.message).startedAt
  const completedAt = metadata(sections.at(-1)?.message).completedAt
  const totalProcessingMs = metadata(sections.at(-1)?.message).totalProcessingMs
  const hasTotalProcessingMs =
    typeof totalProcessingMs === 'number' && Number.isFinite(totalProcessingMs)
  const baseProcessingMs = hasTotalProcessingMs ? totalProcessingMs : 0
  const hasDuration =
    typeof startedAt === 'number' &&
    Number.isFinite(startedAt) &&
    typeof completedAt === 'number' &&
    Number.isFinite(completedAt) &&
    completedAt >= startedAt
  const durationPart = hasTotalProcessingMs
    ? formatProcessingDurationMs(totalProcessingMs)
    : hasDuration
      ? formatProcessingDuration(startedAt, completedAt)
      : null
  const summary = defaultOpen ? (
    waiting ? (
      durationPart ? `等待回答 · ${durationPart}` : '等待回答'
    ) : typeof startedAt === 'number' && Number.isFinite(startedAt) ? (
      <LiveProcessingDuration startedAt={startedAt} baseMs={baseProcessingMs} active={active} />
    ) : (
      '处理过程'
    )
  ) : durationPart ? (
    `${aborted ? interruptedSummary : '已完成'} · ${durationPart}`
  ) : aborted ? (
    interruptedSummary
  ) : (
    '已完成'
  )
  const [open, setOpenSticky] = useStickyOpen(initialOpen, defaultOpen)

  return (
    <Collapsible
      data-activity-history
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen)
        setOpenSticky(nextOpen)
      }}
      className="not-prose min-w-0"
    >
      <CollapsibleTrigger className="group/summary flex w-full min-w-0 cursor-pointer flex-wrap items-center gap-x-2 gap-y-3 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 transition-[opacity,transform]',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/summary:opacity-100'
          )}
        />
        <span className="order-last h-px w-full basis-full bg-border" />
      </CollapsibleTrigger>
      {open ? (
        <CollapsibleContent className="mt-3 flex flex-col gap-3">
          {sections.map((section, index) => {
            const streaming = section.streaming
            return (
              <ActivityGroupPart
                key={`${section.message.id}-${index}`}
                item={{
                  ...section.item,
                  summary: section.title,
                  // waiting（ask_user 暂停、等待回答）时处理未结束，进度组应展开让用户看到
                  // 进度（而非只折叠成标题行），不应只在 streaming 时展开。
                  defaultOpen: streaming || waiting
                }}
                message={section.message}
                streaming={section.streaming}
                active={active}
                additionalContent={section.continuations?.map((continuation, continuationIndex) => (
                  <ActivityGroupPart
                    key={`${continuation.message.id}-${continuationIndex}`}
                    item={continuation.item}
                    message={continuation.message}
                    streaming={continuation.streaming}
                    active={active}
                    contentOnly
                  />
                ))}
                summaryClassName={streaming ? 'text-foreground' : 'text-muted-foreground'}
                summaryIcon={
                  streaming ? (
                    <LoaderCircleIcon
                      data-stage-status="active"
                      className="size-4 shrink-0 animate-spin"
                    />
                  ) : (
                    <CheckCircleIcon data-stage-status="completed" className="size-4 shrink-0" />
                  )
                }
              />
            )
          })}
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  )
}
