import { stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineTool, type ToolRunContext } from '../../../main/core/plugin/protocol'
import { normalizedChunks } from './stream'
import { markRead } from './state'

const READ_CHARACTER_UNIT = 1_000
const MIN_READ_UNITS = 5
const MAX_READ_UNITS = 100

const inputSchema = z
  .object({
    file_path: z.string().describe('Absolute path to the file'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Start line (1-based)'),
    column: z
      .number()
      .int()
      .positive()
      .default(1)
      .describe('Start character within the start line (1-based)'),
    limit: z
      .number()
      .int()
      .default(50)
      .transform(
        (value) => Math.max(MIN_READ_UNITS, Math.min(value, MAX_READ_UNITS)) * READ_CHARACTER_UNIT
      )
      .describe(
        'Number of 1,000-character units to read (for example, 5 reads 5,000 characters); clamped to 5-100'
      ),
    scroll: z
      .enum(['down', 'up'])
      .default('down')
      .describe('Read down or up from the start position')
  })
  .strict()

async function textLength(target: string): Promise<number> {
  let length = 0
  for await (const chunk of normalizedChunks(target)) length += chunk.length
  return length
}

async function anchorIndex(target: string, line: number, column: number): Promise<number> {
  let length = 0
  let lines = 1
  let lineStart = 0
  for await (const chunk of normalizedChunks(target)) {
    for (let at = chunk.indexOf('\n'); at >= 0; at = chunk.indexOf('\n', at + 1)) {
      lines += 1
      if (lines === line + 1) return Math.min(lineStart + column - 1, length + at)
      if (lines <= line) lineStart = length + at + 1
    }
    length += chunk.length
  }
  return Math.min(lineStart + column - 1, length)
}

interface Position {
  index: number
  line: number
  lineStart: number
}

const positionAt = (chunkStart: Position, chunk: string, index: number): Position => {
  let { line, lineStart } = chunkStart
  for (
    let at = chunk.indexOf('\n');
    at >= 0 && chunkStart.index + at < index;
    at = chunk.indexOf('\n', at + 1)
  ) {
    line += 1
    lineStart = chunkStart.index + at + 1
  }
  return { index, line, lineStart }
}

const describePosition = (at: Position): string =>
  at.index === at.lineStart
    ? `offset ${at.line}`
    : `offset ${at.line} column ${at.index - at.lineStart + 1}`

interface Window {
  text: string
  start: Position
  continueFrom: Position | null
}

async function readWindow(target: string, from: number, to: number): Promise<Window> {
  let position: Position = { index: 0, line: 1, lineStart: 0 }
  let start: Position | null = null
  let text = ''
  for await (const chunk of normalizedChunks(target)) {
    const { index } = position
    const next = index + chunk.length
    if (from < next) start ??= positionAt(position, chunk, from)
    text += chunk.slice(Math.max(from - index, 0), Math.min(to - index, chunk.length))
    if (to < next) {
      return { text, start: start ?? position, continueFrom: positionAt(position, chunk, to) }
    }
    position = positionAt(position, chunk, next)
  }
  return { text, start: start ?? position, continueFrom: null }
}

type ReadFileArgs = z.infer<typeof inputSchema>

export async function readFileWindow(args: ReadFileArgs, ctx: ToolRunContext): Promise<string> {
  const { file_path, offset, column, limit, scroll } = args
  const target = path.resolve(ctx.cwd, file_path)
  const stats = await stat(target)
  const startLine = Math.max(1, offset ?? 1)

  const anchor =
    offset !== undefined
      ? await anchorIndex(target, startLine, column)
      : scroll === 'up'
        ? await textLength(target)
        : 0
  const from = scroll === 'up' ? Math.max(0, anchor - limit) : anchor
  const to = scroll === 'up' ? anchor : anchor + limit
  const window = await readWindow(target, from, to)
  markRead(ctx.sessionId, target, stats.mtimeMs)

  return [
    from > 0 ? `(Omitted before ${describePosition(window.start)}.)` : null,
    window.text,
    window.continueFrom ? `(Continue from ${describePosition(window.continueFrom)}.)` : null
  ]
    .filter((part) => part !== null)
    .join('\n')
}

export const readFileTool = defineTool({
  description: 'Read a text file.',
  metadata: { icon: 'read', eager: true },
  inputSchema,
  execute: readFileWindow
})
