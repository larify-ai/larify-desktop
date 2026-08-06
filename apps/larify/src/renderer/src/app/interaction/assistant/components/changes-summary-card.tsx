import { cn } from '@renderer/lib/utils'
import { ChangesIcon } from '../../../../../../extensions/workspace/renderer/changes-icon'
import { setReviewRound } from '../../../../../../extensions/workspace/renderer/review-changes'
import type { ChangedFileSummary } from '../lib/change-summary'

export function ChangesSummaryCard({
  additions,
  className,
  deletions,
  files
}: {
  additions: number
  className?: string
  deletions: number
  files: ChangedFileSummary[]
}): React.JSX.Element {
  const openChange = (selectedPath: string): void => {
    setReviewRound({ files, selectedPath })
    window.dispatchEvent(new CustomEvent('larify:workbench-open', { detail: 'workspace' }))
  }

  return (
    <section
      aria-label={`已编辑 ${files.length} 个文件`}
      className={cn(
        'not-prose w-full overflow-hidden rounded-xl border border-border bg-card',
        className
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <ChangesIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1 text-sm font-medium">
          已编辑 {files.length} 个文件
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-xs">
          <span className="text-[var(--git-added)]">+{additions}</span>
          <span className="text-[var(--git-deleted)]">−{deletions}</span>
        </div>
      </div>
      <div className="max-h-[10rem] overflow-y-auto border-t border-border bg-muted/20 px-2 py-1.5">
        {files.map((file) => (
          <button
            type="button"
            key={file.path}
            className="flex w-full min-w-0 items-center gap-2 rounded-md py-1.5 pr-2 pl-3.5 text-left text-xs hover:bg-muted"
            onClick={() => openChange(file.path)}
          >
            <span className="min-w-0 flex-1 truncate font-mono" title={file.path}>
              {file.path}
            </span>
            <span className="shrink-0 font-mono text-[var(--git-added)]">
              +{file.additions}
            </span>
            <span className="shrink-0 font-mono text-[var(--git-deleted)]">
              −{file.deletions}
            </span>
          </button>
        ))}
      </div>
    </section>
  )
}
