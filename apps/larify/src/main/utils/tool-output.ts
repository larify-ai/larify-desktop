import { writeFileSync } from "node:fs"
import { larifyTempPath } from "./app-paths"
import { createUniqueFile } from "./unique-path"

export type ToolPayload = { inline: string } | { path: string; bytes: number; preview: string }

const SPILL_THRESHOLD = 30_000
const PREVIEW_CHARS = 1500

export function prepareToolOutput(content: string): ToolPayload {
  const bytes = Buffer.byteLength(content, "utf8")
  if (bytes <= SPILL_THRESHOLD) return { inline: content }
  const path = createUniqueFile(larifyTempPath("tool-output"))
  writeFileSync(path, content, "utf8")
  return { path, bytes, preview: content.slice(0, PREVIEW_CHARS) }
}
