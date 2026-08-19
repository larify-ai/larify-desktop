import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTwoFilesPatch } from 'diff'
import { z } from 'zod'
import { defineTool } from '../../../main/core/plugin/protocol'
import { applyLineBreaks, dominantLineBreak, normalizeLineBreaks } from '../../../main/utils/text'
import { decodeText } from './encoding'
import { formatFileDiagnostics, provideFileDiagnostics } from './diagnostics'
import { markRead, readAtFor, withFileLock } from './state'

const inputSchema = z
  .object({
    file_path: z.string().describe('Absolute path to the file'),
    old_string: z.string().min(1).describe('The exact text to replace'),
    new_string: z.string().describe('The text to replace it with'),
    replace_all: z
      .boolean()
      .optional()
      .default(false)
      .describe('Replace all occurrences (optional; defaults to false)')
  })
  .strict()

export const editFileTool = defineTool({
  description: 'Replace exact text in a file.',
  metadata: { icon: 'edit', eager: true },
  inputSchema,
  execute: async (args, ctx) => {
    const { file_path, replace_all } = args
    const old_string = normalizeLineBreaks(args.old_string)
    const new_string = normalizeLineBreaks(args.new_string)
    const target = path.resolve(ctx.cwd, file_path)

    if (old_string === new_string) {
      throw new Error('old_string and new_string are identical.')
    }

    return withFileLock(target, async () => {
      const readAt = readAtFor(ctx.sessionId, target)
      if (readAt === undefined) {
        throw new Error('Read the file before editing it.')
      }
      if (Math.floor((await stat(target)).mtimeMs) > readAt) {
        throw new Error('The file was modified since you read it. Read it again before editing.')
      }

      const original = decodeText(await readFile(target))
      const lineBreak = dominantLineBreak(original)
      const content = normalizeLineBreaks(original)

      const count = content.split(old_string).length - 1
      if (count === 0) {
        throw new Error(`old_string not found in ${target}.`)
      }
      if (count > 1 && !replace_all) {
        throw new Error(
          `old_string appears ${count} times in ${target}. Add more surrounding context to make it unique, or set replace_all to true.`
        )
      }

      const updated = content.split(old_string).join(new_string)
      await writeFile(target, applyLineBreaks(updated, lineBreak))
      markRead(ctx.sessionId, target, (await stat(target)).mtimeMs)
      const diagnostics = formatFileDiagnostics(await provideFileDiagnostics(target))

      ctx.trackFileChange?.({ path: target, before: content, after: updated })
      const patch = createTwoFilesPatch(target, target, content, updated, '', '', { context: 3 })
      return {
        kind: 'diff' as const,
        path: target,
        patch,
        summary: replace_all ? `Edited ${target} (${count} replacements).` : `Edited ${target}.`,
        ...(diagnostics ? { diagnostics } : {})
      }
    })
  },
  toModelOutput: (output) => ({
    type: 'text',
    value: output.summary + (output.diagnostics ?? '')
  })
})
