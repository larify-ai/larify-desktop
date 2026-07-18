import { readFile, stat } from "node:fs/promises"
import { detect } from "chardet"
import iconv from "iconv-lite"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { splitLines } from "../../../main/utils/text"
import { fileStateFor } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  offset: z.number().int().positive().optional().describe("Start line (1-based)"),
  limit: z.number().int().positive().default(2000).describe("Number of lines to read"),
  scroll: z.enum(["down", "up"]).default("down").describe("Read down or up from offset"),
}).strict()

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a text file.",
  metadata: { icon: "read" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, offset, limit, scroll } = inputSchema.parse(args)

    const stats = await stat(file_path)
    const buffer = await readFile(file_path)
    fileStateFor(ctx.sessionId).set(file_path, Math.floor(stats.mtimeMs))

    const lines = splitLines(iconv.decode(buffer, detect(buffer) ?? "utf-8"))
    const lastLine = lines.length
    const anchor = Math.min(offset ?? (scroll === "up" ? lastLine : 1), lastLine)
    const start = Math.min(
      lastLine + 1,
      scroll === "up" ? Math.max(1, anchor - limit + 1) : Math.max(1, anchor),
    )
    const end = Math.max(
      0,
      scroll === "up" ? Math.min(lastLine, anchor) : Math.min(lastLine, start + limit - 1),
    )

    let body = lines.slice(start - 1, end).join("\n")
    if (start > 1) body = `(Lines 1-${start - 1} omitted.)\n${body}`
    if (end < lastLine) body += `\n(Lines ${end + 1}-${lastLine} omitted.)`
    return body
  },
}
