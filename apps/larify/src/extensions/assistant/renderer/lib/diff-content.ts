import { applyPatch } from "diff"

export interface DiffViewContents {
  oldContent: string
  newContent: string
}

export function diffContentsForView({
  oldContent,
  newContent,
  patch,
}: {
  oldContent: string
  newContent: string
  patch: string
}): DiffViewContents | null {
  const patched = applyPatch(oldContent, patch)
  if (patched === newContent) return { oldContent, newContent }
  return null
}
