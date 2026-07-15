import { readFile, stat } from "node:fs/promises"
import { detect } from "chardet"
import iconv from "iconv-lite"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { fileStateFor } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  offset: z.number().int().positive().default(1).describe("Start line (1-based)"),
  limit: z.number().int().positive().default(2000).describe("Number of lines to read"),
})

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a text file.",
  metadata: { icon: "read" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, offset, limit } = args as z.infer<typeof inputSchema>

    const stats = await stat(file_path)
    const buffer = await readFile(file_path)
    fileStateFor(ctx.sessionId).set(file_path, Math.floor(stats.mtimeMs))

    const lines = iconv.decode(buffer, detect(buffer) ?? "utf-8").split(/\r?\n/)
    const start = Math.max(1, offset)
    const end = Math.min(lines.length, start + limit - 1)

    let body = lines.slice(start - 1, end).join("\n")
    if (start > 1) body = `(Lines 1-${start - 1} omitted.)\n${body}`
    if (end < lines.length) body += `\n(Lines ${end + 1}-${lines.length} omitted.)`
    return body
  },
}
