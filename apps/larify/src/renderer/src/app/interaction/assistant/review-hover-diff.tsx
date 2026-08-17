import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'
import { useTheme } from 'next-themes'
import { useMemo } from 'react'
import type { ChangedFileSummary } from './change-summary'

export function ReviewHoverDiff({ file }: { file: ChangedFileSummary }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const unavailable = /^@@/m.test(file.patch) ? null : '没有可预览的文本变更'
  const data = useMemo(
    () => ({
      oldFile: { fileName: file.path },
      newFile: { fileName: file.path },
      hunks: [file.patch]
    }),
    [file.patch, file.path]
  )
  return (
    <div className="larify-file-diff overflow-hidden rounded-md border border-border bg-card text-xs">
      <div className="truncate border-b border-border bg-muted/50 px-3 py-2 font-mono text-muted-foreground">
        {file.path}
      </div>
      <div className="max-h-72 overflow-auto">
        {unavailable ? (
          <div className="px-3 py-5 text-center text-muted-foreground">{unavailable}</div>
        ) : (
          <DiffView
            data={data}
            diffViewHighlight
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme={resolvedTheme === 'light' ? 'light' : 'dark'}
          />
        )}
      </div>
    </div>
  )
}
