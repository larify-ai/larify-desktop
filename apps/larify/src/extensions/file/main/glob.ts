import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { runRipgrepLimited, toAbsolutePath } from "./ripgrep"

const inputSchema = z.object({
  pattern: z.string().describe("The glob pattern to match files against"),
  path: z
    .string()
    .optional()
    .describe("The directory to search in. If omitted, the session working directory is used."),
  limit: z.number().int().positive().default(100).describe("Maximum number of file paths to return"),
  offset: z.number().int().nonnegative().default(0).describe("Skip the first N matching file paths"),
})

export const globFilesTool: Tool = {
  name: "glob",
  description: "Find files by glob pattern.",
  metadata: { icon: "search" },
  inputSchema,
  execute: async (args, ctx) => {
    const { pattern, path: searchPath, limit, offset } = inputSchema.parse(args)
    const root = path.resolve(searchPath ?? ctx.cwd ?? process.cwd())
    const stats = await stat(root)
    if (!stats.isDirectory()) throw new Error(`Path is not a directory: ${root}`)

    const result = await runRipgrepLimited(
      [
        "--no-config",
        "--files",
        "--glob",
        pattern,
        "--sort=modified",
        "--hidden",
        "--no-ignore",
        "--no-messages",
        "--glob",
        "!**/.git/**",
      ],
      root,
      { offset, limit: limit + 1 },
    )
    const files = result.lines.slice(0, limit).map((filePath) => toAbsolutePath(root, filePath))

    if (files.length === 0) return "No files found."
    let output = files.join("\n")
    if (result.truncated || result.lines.length > limit) {
      output += `\n(More results omitted; use offset ${offset + files.length} to continue or narrow the search.)`
    }
    return output
  },
}
