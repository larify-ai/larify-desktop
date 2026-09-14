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
    // flex 列布局 + 内容区 min-h-0 + 外层 --larify-preview-max：当卡片靠近视口边界、
    // 该方向可用空间不足时，changes-summary-card 会给出这个上限，本组件整体高度被钳制、
    // 头部固定、内容区收缩并内部滚动，而不是整体溢出被视口裁掉（用户所报"显示不全"）。
    <div
      className="larify-file-diff flex flex-col overflow-hidden rounded-md border border-border bg-card text-xs"
      style={{ maxHeight: 'var(--larify-preview-max, none)' }}
    >
      <div className="shrink-0 truncate border-b border-border bg-muted/50 px-3 py-2 font-mono text-muted-foreground">
        {file.path}
      </div>
      <div className="max-h-72 min-h-0 flex-1 overflow-auto overscroll-contain">
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
