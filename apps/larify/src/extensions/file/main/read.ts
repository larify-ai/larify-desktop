import { readFile, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"
import { splitLines } from "../../../main/utils/text"
import { decodeText } from "./encoding"
import { markRead } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  line: z.number().int().positive().optional().describe("Start line (1-based)"),
  column: z.number().int().positive().default(1).describe("Start character within the start line (1-based)"),
  limit: z.number().int().positive().max(100_000).default(50_000).describe("Maximum number of characters to read"),
  scroll: z.enum(["down", "up"]).default("down").describe("Read down or up from the start position"),
}).strict()

const lineStarts = (lines: string[]): number[] => {
  const starts: number[] = []
  let at = 0
  for (const text of lines) {
    starts.push(at)
    at += text.length + 1
  }
  return starts
}

const positionOf = (starts: number[], index: number): string => {
  let line = starts.length
  while (line > 1 && starts[line - 1] > index) line -= 1
  const column = index - starts[line - 1] + 1
  return column === 1 ? `line ${line}` : `line ${line} column ${column}`
}

export const readFileTool = defineTool({
  description: "Read a text file.",
  metadata: { icon: "read" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, line, column, limit, scroll } = args
    const target = path.resolve(ctx.cwd, file_path)
    const stats = await stat(target)
    const buffer = await readFile(target)
    markRead(ctx.sessionId, target, stats.mtimeMs)

    const lines = splitLines(decodeText(buffer))
    const text = lines.join("\n")
    const starts = lineStarts(lines)
    const anchor = Math.min(
      line === undefined
        ? scroll === "up"
          ? text.length
          : 0
        : starts[Math.min(line, lines.length) - 1] + column - 1,
      text.length,
    )

    const start = Math.max(0, Math.min(scroll === "up" ? anchor - limit : anchor, text.length))
    const end = Math.max(start, Math.min(scroll === "up" ? anchor : anchor + limit, text.length))

    return [
      start > 0 ? `(Earlier content omitted; this starts at ${positionOf(starts, start)}.)` : null,
      text.slice(start, end),
      end < text.length ? `(More follows; continue from ${positionOf(starts, end)}.)` : null,
    ]
      .filter((part) => part !== null)
      .join("\n")
  },
})
