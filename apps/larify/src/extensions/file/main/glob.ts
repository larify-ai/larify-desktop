import { stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"
import { runRipgrepLimited, toAbsolutePath } from "./ripgrep"

const inputSchema = z.object({
  path: z
    .string()
    .optional()
    .describe("The directory to search in. If omitted, the current working directory is used."),
  pattern: z.string().describe("Glob pattern, relative to the search directory"),
  limit: z.number().int().positive().max(1000).default(100).describe("Maximum number of file paths to return"),
  offset: z.number().int().nonnegative().default(0).describe("Skip the first N matching file paths"),
}).strict()

const rgArgs = (pattern: string): string[] => [
  "--no-config",
  "--files",
  "--glob",
  pattern,
  "--sortr=modified",
  "--hidden",
  "--no-ignore",
  "--no-messages",
  "--glob",
  "!**/.git/**",
]

export const globFilesTool = defineTool({
  description: `Find files by glob pattern, by running: rg ${rgArgs("<pattern>").join(" ")} <path>`,
  metadata: { icon: "search", eager: true },
  inputSchema,
  execute: async (args, ctx) => {
    const { pattern, path: searchPath, limit, offset } = args
    const root = path.resolve(ctx.cwd, searchPath ?? ".")
    const stats = await stat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return String(error)
      throw error
    })
    if (typeof stats === "string") return stats
    if (!stats.isDirectory()) throw new Error(`Path is not a directory: ${root}`)

    const result = await runRipgrepLimited(rgArgs(pattern), root, {
      offset,
      limit: limit + 1,
      signal: ctx.signal,
    })
    const files = result.lines.slice(0, limit).map((filePath) => toAbsolutePath(root, filePath))

    if (files.length === 0) {
      return result.truncated
        ? "Search stopped before any file was found. Narrow the search."
        : "No files found."
    }
    let output = files.join("\n")
    if (result.truncated || result.lines.length > limit) {
      output += `\n(More results omitted; use offset ${offset + files.length} to continue or narrow the search.)`
    }
    return output
  },
})
