import { DiffView, DiffModeEnum } from "@git-diff-view/react"
import "@git-diff-view/react/styles/diff-view.css"
import { useTheme } from "next-themes"
import { diffContentsForView } from "../lib/diff-content"

export interface DiffMeta {
  kind: "diff"
  path: string
  patch: string
  oldContent?: string | null
  newContent?: string
}

export function FileDiff({ meta }: { meta: DiffMeta }): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const lang = meta.path.split(".").pop()?.toLowerCase() ?? ""
  const oldContent = meta.oldContent ?? ""
  const newContent = meta.newContent ?? ""
  const contents = diffContentsForView({ oldContent, newContent, patch: meta.patch })

  return (
    <div className="larify-file-diff overflow-hidden rounded-md border border-border bg-muted/30 text-xs">
      <div className="border-b border-border bg-muted/50 px-3 py-1.5 font-mono text-muted-foreground">
        {meta.path}
      </div>
      <DiffView
        data={{
          oldFile: { fileName: meta.path, fileLang: lang, content: contents?.oldContent },
          newFile: { fileName: meta.path, fileLang: lang, content: contents?.newContent },
          hunks: [meta.patch],
        }}
        diffViewMode={DiffModeEnum.Unified}
        diffViewHighlight
        diffViewWrap
        diffViewTheme={resolvedTheme === "light" ? "light" : "dark"}
      />
    </div>
  )
}
