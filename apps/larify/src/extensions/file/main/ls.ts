import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"

const inputSchema = z.object({
  path: z.string().optional().describe("The directory to list. If omitted, the current working directory is used."),
  limit: z.number().int().positive().max(1000).default(200).describe("Maximum number of items to return"),
  offset: z.number().int().nonnegative().default(0).describe("Skip the first N items"),
}).strict()

interface Item {
  name: string
  isDirectory: boolean
}

const formatItem = (item: Item): string => item.name + (item.isDirectory ? "/" : "")

export const lsTool = defineTool({
  description: "List directory contents.",
  metadata: { icon: "read", eager: true },
  inputSchema,
  execute: async (args, ctx) => {
    const { path: targetPath, limit, offset } = args
    const root = path.resolve(ctx.cwd, targetPath ?? ".")
    const rootStats = await stat(root)
    if (!rootStats.isDirectory()) throw new Error(`Path is not a directory: ${root}`)

    const entries = await readdir(root, { withFileTypes: true })
    const items = await Promise.all(
      entries.map(async (entry) => ({
        name: entry.name,
        isDirectory: entry.isSymbolicLink()
          ? await stat(path.join(root, entry.name)).then(
              (linked) => linked.isDirectory(),
              () => false,
            )
          : entry.isDirectory(),
      })),
    )

    const end = Math.min(items.length, offset + limit)
    const page = items.slice(offset, end).map(formatItem)

    if (page.length === 0) return "No items found."
    let output = page.join("\n")
    if (offset > 0) output = `(Items 1-${offset} omitted.)\n${output}`
    if (end < items.length) output += `\n(Items ${end + 1}-${items.length} omitted.)`
    return output
  },
})
