import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createTwoFilesPatch } from "diff"
import { z } from "zod"
import { defineTool } from "../../../shared/tool"
import { applyLineBreaks, dominantLineBreak, normalizeLineBreaks } from "../../../main/utils/text"
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
    const content = normalizeLineBreaks(args.content)
    const target = resolve(ctx.cwd, file_path)

    return withFileLock(target, async () => {
      let oldContent: string | null = null
      let lineBreak = "\n"

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

        const original = decodeText(await readFile(target))
        lineBreak = dominantLineBreak(original)
        oldContent = normalizeLineBreaks(original)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }

      if (oldContent !== null && content === oldContent) {
        throw new Error("The content is identical to the current file. Nothing to write.")
      }

      await mkdir(dirname(target), { recursive: true })
      const temp = `${target}.${process.pid}.tmp`
      try {
        await writeFile(temp, applyLineBreaks(content, lineBreak))
        await rename(temp, target)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
      markRead(ctx.sessionId, target, (await stat(target)).mtimeMs)

      const type = oldContent === null ? "create" : "update"
      const patch = createTwoFilesPatch(target, target, oldContent ?? "", content, "", "", {
        context: 3,
      })

      return {
        kind: "diff" as const,
        path: target,
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
