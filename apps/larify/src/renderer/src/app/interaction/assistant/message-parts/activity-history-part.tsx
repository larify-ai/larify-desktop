import { useEffect, useRef, useState } from 'react'
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
import { formatProcessingDuration } from '../processing-duration'
import { ActivityGroupPart } from './activity-group-part'

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
  initialOpen,
  onOpenChange
}: {
  sections: ActivityHistorySection[]
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
}): React.JSX.Element {
  const defaultOpen = sections.some(({ streaming }) => streaming)
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
  const startedAt = metadata(sections[0]?.message).startedAt
  const completedAt = metadata(sections.at(-1)?.message).completedAt
  const hasDuration =
    typeof startedAt === 'number' &&
    Number.isFinite(startedAt) &&
    typeof completedAt === 'number' &&
    Number.isFinite(completedAt) &&
    completedAt >= startedAt
  const summary = defaultOpen ? (
    typeof startedAt === 'number' && Number.isFinite(startedAt) ? (
      <LiveProcessingDuration startedAt={startedAt} />
    ) : (
      '处理过程'
    )
  ) : hasDuration ? (
    `${aborted ? '已中断' : '已完成'} · ${formatProcessingDuration(startedAt, completedAt)}`
  ) : aborted ? (
    '已中断'
  ) : (
    '已完成'
  )
  const [open, setOpen] = useState(initialOpen ?? defaultOpen)
  const wasDefaultOpen = useRef(defaultOpen)

  useEffect(() => {
    if (wasDefaultOpen.current !== defaultOpen) setOpen(defaultOpen)
    wasDefaultOpen.current = defaultOpen
  }, [defaultOpen])

  return (
    <Collapsible
      data-activity-history
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange?.(nextOpen)
        setOpen(nextOpen)
      }}
      className="not-prose min-w-0"
    >
      <CollapsibleTrigger className="group/summary flex w-full min-w-0 cursor-pointer items-center gap-x-2 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronRightIcon
          className={cn(
            'size-3.5 shrink-0 transition-[opacity,transform]',
            open ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/summary:opacity-100'
          )}
        />
      </CollapsibleTrigger>
      {open ? (
        <CollapsibleContent className="mt-3 flex flex-col gap-3">
          {sections.map((section, index) => {
            const active = section.streaming
            return (
              <ActivityGroupPart
                key={`${section.message.id}-${index}`}
                item={{
                  ...section.item,
                  summary: section.title,
                  defaultOpen: active
                }}
                message={section.message}
                streaming={section.streaming}
                additionalContent={section.continuations?.map((continuation, continuationIndex) => (
                  <ActivityGroupPart
                    key={`${continuation.message.id}-${continuationIndex}`}
                    item={continuation.item}
                    message={continuation.message}
                    streaming={continuation.streaming}
                    contentOnly
                  />
                ))}
                summaryClassName={active ? 'text-foreground' : 'text-muted-foreground'}
                summaryIcon={
                  active ? (
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
