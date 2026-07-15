import { readFile, stat, writeFile } from "node:fs/promises"
import { detect } from "chardet"
import { createTwoFilesPatch } from "diff"
import iconv from "iconv-lite"
import { z } from "zod"
import type { Tool } from "../../../shared/tool"
import { fileStateFor, withFileLock } from "./state"

const inputSchema = z.object({
  file_path: z.string().describe("Absolute path to the file"),
  old_string: z.string().describe("The exact text to replace"),
  new_string: z.string().describe("The text to replace it with"),
  replace_all: z.boolean().default(false).describe("Replace all occurrences (default false)"),
})

export const editFileTool: Tool = {
  name: "edit_file",
  description: "Replace exact text in a file.",
  metadata: { icon: "edit", defaultOpen: true, hideRawDetails: true },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, old_string, new_string, replace_all } = args as z.infer<typeof inputSchema>

    if (old_string === new_string) {
      throw new Error("old_string and new_string are identical.")
    }

    return withFileLock(file_path, async () => {
      const fileState = fileStateFor(ctx.sessionId)
      const readAt = fileState.get(file_path)
      if (readAt === undefined) {
        throw new Error(`You must read ${file_path} before editing it.`)
      }
      if (Math.floor((await stat(file_path)).mtimeMs) > readAt) {
        throw new Error(`${file_path} was modified since you read it. Read it again before editing.`)
      }

      const buffer = await readFile(file_path)
      const encoding = detect(buffer) ?? "utf-8"
      const content = iconv.decode(buffer, encoding)

      const count = content.split(old_string).length - 1
      if (count === 0) {
        throw new Error(`old_string not found in ${file_path}.`)
      }
      if (count > 1 && !replace_all) {
        throw new Error(
          `old_string appears ${count} times in ${file_path}. Add more surrounding context to make it unique, or set replace_all to true.`,
        )
      }

      const updated = content.split(old_string).join(new_string)
      await writeFile(file_path, iconv.encode(updated, encoding))
      fileState.set(file_path, Math.floor((await stat(file_path)).mtimeMs))

      const patch = createTwoFilesPatch(file_path, file_path, content, updated, "", "", { context: 3 })
      return {
        output: replace_all ? `Edited ${file_path} (${count} replacements).` : `Edited ${file_path}.`,
        metadata: {
          kind: "diff",
          path: file_path,
          patch,
          oldContent: content,
          newContent: updated,
        },
      }
    })
  },
}
