import { stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { defineTool, type ToolRunContext } from '../../../main/core/plugin/protocol'
import { normalizedChunks } from './stream'
import { markRead, onReadStateCleared } from './state'

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

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

const wholeStart = (chunk: string, at: number): number =>
  at > 0 && isLowSurrogate(chunk.charCodeAt(at)) ? at - 1 : at

const wholeEnd = (chunk: string, at: number): number =>
  at > 0 && isHighSurrogate(chunk.charCodeAt(at - 1)) ? at + 1 : at

async function readWindow(target: string, from: number, to: number): Promise<Window> {
  let position: Position = { index: 0, line: 1, lineStart: 0 }
  let start: Position | null = null
  let text = ''
  for await (const chunk of normalizedChunks(target)) {
    const { index } = position
    const next = index + chunk.length
    const head = wholeStart(chunk, Math.max(from - index, 0))
    const tail = wholeEnd(chunk, Math.min(to - index, chunk.length))
    if (from < next) start ??= positionAt(position, chunk, index + head)
    text += chunk.slice(head, tail)
    if (to < next) {
      return {
        text,
        start: start ?? position,
        continueFrom: positionAt(position, chunk, index + tail)
      }
    }
    position = positionAt(position, chunk, next)
  }
  return { text, start: start ?? position, continueFrom: null }
}

type ReadFileArgs = z.infer<typeof inputSchema>

/**
 * 每个会话读过、且已经读到文件末尾的窗口 → 当时读到的 mtime。键是「会话 + 文件 + 真实起止
 * 行」而不是调用方传的 offset/column/limit/scroll——那四个参数只是「怎么求窗口」的手段，换一组
 * 参数完全可能落到同一段文字上，用参数当键会把真正的重复判成不同。只有读到末尾的窗口才登记：
 * 否则文件后来追加的内容会被当成「没变过」直接挡掉。
 */
const readWindows = new Map<string, number>()

/**
 * 上下文被清空（reset context / 会话删除）时，本会话的「已读窗口」也必须一起作废：那时之前送进
 * 上下文的那段正文已经不在模型眼前了，再回「内容没变、无需重读」就等于让模型永远看不到这段文字。
 * 用 `sessionId\0` 前缀清扫，键的前半段与 `readFileWindow` 里的拼接顺序保持一致。
 */
onReadStateCleared((sessionId) => {
  const prefix = `${sessionId}\u0000`
  for (const key of readWindows.keys()) if (key.startsWith(prefix)) readWindows.delete(key)
})

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

  // 同一会话、同一文件、同一段文字（由窗口的起止下标唯一确定，不必再看 offset/scroll 是哪种
  // 形态）已经读过，且磁盘没变、上次还读到了文件末尾 ⇒ 这段文字早就在本会话更早的工具结果里，
  // 再送一遍只是重复占上下文。mtime 是不可省的那半个判据：内容被原地换成同样长度时起止不变。
  const mtime = Math.floor(stats.mtimeMs)
  const seenKey = `${ctx.sessionId}\u0000${target}\u0000${from}\u0000${to}`
  if (window.continueFrom === null && readWindows.get(seenKey) === mtime) {
    return 'File unchanged since the last read; that content is still current, no need to re-read.'
  }
  markRead(ctx.sessionId, target, stats.mtimeMs)
  if (window.continueFrom === null) readWindows.set(seenKey, mtime)

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
