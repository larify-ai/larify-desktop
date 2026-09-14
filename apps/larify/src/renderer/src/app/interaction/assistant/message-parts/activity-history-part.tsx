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

// 阶段分组（stage section）展开状态的持久化 key。key 的单一来源：
// ActivityHistoryPart 内部渲染与调用方（message-list）清理 openActivities 时
// 都复用这一函数，避免两处硬编码格式不同步。
export function activityHistorySectionKey(
  section: ActivityHistorySection,
  index: number
): string {
  return `${section.message.id}-section-${index}`
}

export function ActivityHistoryPart({
  sections,
  waiting = false,
  initialOpen,
  onOpenChange,
  stageOpen,
  active = true
}: {
  sections: ActivityHistorySection[]
  waiting?: boolean
  initialOpen?: boolean
  onOpenChange?: (open: boolean) => void
  // 阶段分组（stage section）展开状态的持久化通道。虚拟列表回收重挂载后，
  // 内层 stage 的 open 状态不能丢；否则用户手动展开的已完成 stage 在流式
  // 继续推进（行被 remount）时会弹回折叠（defaultOpen=false）。
  // 说明：调用方通常复用与"外层展开"相同的 handleActivityOpenChange，因此展开
  // 内层 stage 也会退出底部跟随/保持阅读位置/显示返回按钮——这是有意为之，
  // 与整体展开行为一致，让用户能稳定查看展开的 stage 而不被流式"顶走"。
  stageOpen?: {
    get(key: string): boolean | undefined
    set(key: string, open: boolean): void
  }
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
      {/* 不能用 flex-wrap：同 activity-group-part，长标题会把箭头挤到下一行。 */}
      <CollapsibleTrigger className="group/summary flex w-full min-w-0 cursor-pointer flex-nowrap items-center gap-x-2 gap-y-3 text-sm text-muted-foreground">
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
            const sectionKey = activityHistorySectionKey(section, index)
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
                initialOpen={
                  // 用户已手动开合过该 stage 时，用持久化值覆盖 defaultOpen；
                  // 否则让 useStickyOpen 走 defaultOpen（streaming/waiting 时默认展开）。
                  // 传入 undefined 时 useStickyOpen 内部回退到 defaultOpen。
                  stageOpen ? stageOpen.get(sectionKey) : undefined
                }
                onOpenChange={
                  stageOpen ? (open) => stageOpen.set(sectionKey, open) : undefined
                }
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
