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

    const entries = (await readdir(root, { withFileTypes: true })).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    if (entries.length === 0) return "No items found."
    if (offset >= entries.length) {
      return `(Offset ${offset} is past the ${entries.length} items in the directory)`
    }

    const end = Math.min(entries.length, offset + limit)
    const page = await Promise.all(
      entries.slice(offset, end).map(async (entry) => {
        const isDirectory = entry.isSymbolicLink()
          ? await stat(path.join(root, entry.name)).then(
              (linked) => linked.isDirectory(),
              () => false,
            )
          : entry.isDirectory()
        return formatItem({ name: entry.name, isDirectory })
      }),
    )

    let output = page.join("\n")
    if (offset > 0) output = `(Items 1-${offset} omitted.)\n${output}`
    if (end < entries.length) output += `\n(Items ${end + 1}-${entries.length} omitted.)`
    return output
  },
})
