import { ChangesIcon } from '../../../../../extensions/workspace/renderer/changes/changes-icon'
import { requestChangesNavigation } from '../../../../../extensions/workspace/renderer/changes/changes-navigation'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../../components/ui/hover-card'
import type { ChangeSummary } from './change-summary'
import { ReviewHoverDiff } from './review-hover-diff'

export function ChangesSummaryCard({
  additions,
  deletions,
  files,
  root
}: ChangeSummary): React.JSX.Element {
  const openChanges = (selectedPath?: string): void => {
    window.dispatchEvent(
      new CustomEvent('larify:workbench-open', {
        detail: {
          onOpen: selectedPath
            ? (resourceId: number) =>
                requestChangesNavigation({
                  path: selectedPath,
                  resourceId
                })
            : undefined,
          options: root ? { root } : undefined,
          rendererId: 'changes'
        }
      })
    )
  }

  return (
    <section
      aria-label={`已编辑 ${files.length} 个文件`}
      className="not-prose mt-3 w-full overflow-hidden rounded-xl border border-border bg-card"
    >
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
        onClick={() => openChanges()}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <ChangesIcon aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium">已编辑 {files.length} 个文件</span>
        <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
          <span className="text-[var(--git-added)]">+{additions}</span>
          <span className="text-[var(--git-deleted)]">−{deletions}</span>
        </span>
      </button>
      <div className="max-h-40 overflow-y-auto border-t border-border bg-muted/20 px-2 py-1.5">
        {files.map((file) => {
          const button = (
            <button
              key={file.path}
              type="button"
              className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2 pl-3.5 text-left text-xs hover:bg-muted"
              onClick={() => openChanges(file.path)}
            >
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className="shrink-0 font-mono text-[var(--git-added)]">+{file.additions}</span>
              <span className="shrink-0 font-mono text-[var(--git-deleted)]">
                −{file.deletions}
              </span>
            </button>
          )
          return file.binary ? (
            button
          ) : (
            <HoverCard key={file.path} openDelay={250} closeDelay={100}>
              <HoverCardTrigger asChild>{button}</HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="start"
                sideOffset={8}
                className="-translate-x-2 w-[calc(var(--radix-hover-card-trigger-width)+1rem)] max-w-[calc(100vw-2rem)] p-0"
              >
                <ReviewHoverDiff file={file} />
              </HoverCardContent>
            </HoverCard>
          )
        })}
      </div>
    </section>
  )
}
