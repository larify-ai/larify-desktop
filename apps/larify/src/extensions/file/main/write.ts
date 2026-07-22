import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createTwoFilesPatch } from "diff"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"
import { splitLines } from "../../../main/utils/text"
import { decodeText } from "./encoding"
import { markRead, readAtFor, withFileLock } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  content: z.string().describe("The content to write to the file"),
}).strict()

export const writeFileTool = defineTool({
  description: "Create or overwrite a text file.",
  metadata: { icon: "edit" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path } = args
    const content = splitLines(args.content).join("\n")
    const target = resolve(ctx.cwd, file_path)

    return withFileLock(target, async () => {
      let oldContent: string | null = null

      try {
        const readAt = readAtFor(ctx.sessionId, target)
        const stats = await stat(target)
        if (stats.isDirectory()) throw new Error(`Path is a directory: ${target}`)
        if (readAt === undefined) {
          throw new Error("Read the file before overwriting it.")
        }
        if (Math.floor(stats.mtimeMs) > readAt) {
          throw new Error("The file was modified since you read it. Read it again before writing.")
        }

        oldContent = splitLines(decodeText(await readFile(target))).join("\n")
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }

      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, content)
      markRead(ctx.sessionId, target, (await stat(target)).mtimeMs)

      const type = oldContent === null ? "create" : "update"
      const patch = createTwoFilesPatch(target, target, oldContent ?? "", content, "", "", {
        context: 3,
      })

      return {
        kind: "diff" as const,
        path: target,
        oldContent,
        newContent: content,
        patch,
        summary:
          type === "create"
            ? `File created successfully at: ${target}`
            : `The file ${target} has been updated successfully.`,
      }
    })
  },
  toModelOutput: (output) => ({ type: "text", value: output.summary }),
})
