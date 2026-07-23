import { DiffView, DiffModeEnum } from "@git-diff-view/react"
import "@git-diff-view/react/styles/diff-view.css"
import { useTheme } from "next-themes"
import type { DiffMeta } from "../lib/diff-meta"

export type { DiffMeta }

export function FileDiff({ meta }: { meta: DiffMeta }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const lang = meta.path.split(".").pop()?.toLowerCase() ?? ""

  return (
    <div className="larify-file-diff overflow-hidden rounded-md border border-border bg-muted/30 text-xs">
      <div className="border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-muted-foreground">
        {meta.path}
      </div>
      <div className="max-h-80 overflow-auto">
        <DiffView
          data={{
            oldFile: { fileName: meta.path, fileLang: lang },
            newFile: { fileName: meta.path, fileLang: lang },
            hunks: [meta.patch],
          }}
          diffViewMode={DiffModeEnum.Unified}
          diffViewHighlight
          diffViewWrap
          diffViewTheme={resolvedTheme === "light" ? "light" : "dark"}
        />
      </div>
    </div>
  )
}
