import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { detect } from "chardet"
import { createTwoFilesPatch } from "diff"
import iconv from "iconv-lite"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { fileStateFor, withFileLock } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  content: z.string().describe("The content to write to the file"),
}).strict()

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create or overwrite a text file.",
  metadata: { icon: "edit" },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, content } = args as z.infer<typeof inputSchema>

    return withFileLock(file_path, async () => {
      const fileState = fileStateFor(ctx.sessionId)
      let oldContent: string | null = null
      let encoding = "utf-8"

      try {
        const readAt = fileState.get(file_path)
        const stats = await stat(file_path)
        if (readAt === undefined) {
          throw new Error("Read the file before overwriting it.")
        }
        if (Math.floor(stats.mtimeMs) > readAt) {
          throw new Error("The file was modified since you read it. Read it again before writing.")
        }

        const buffer = await readFile(file_path)
        encoding = detect(buffer) ?? "utf-8"
        oldContent = iconv.decode(buffer, encoding)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      }

      await mkdir(dirname(file_path), { recursive: true })
      await writeFile(file_path, iconv.encode(content, encoding))
      fileState.set(file_path, Math.floor((await stat(file_path)).mtimeMs))

      const type = oldContent === null ? "create" : "update"
      const patch = createTwoFilesPatch(file_path, file_path, oldContent ?? "", content, "", "", {
        context: 3,
      })

      return {
        output:
          type === "create"
            ? `File created successfully at: ${file_path}`
            : `The file ${file_path} has been updated successfully.`,
        metadata: {
          kind: "diff",
          type,
          path: file_path,
          filePath: file_path,
          oldContent,
          newContent: content,
          patch,
        },
      }
    })
  },
}
