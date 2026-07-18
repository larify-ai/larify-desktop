import type { IBufferCell, IBufferLine, Terminal as HeadlessTerminal } from '@xterm/headless'
import type { TerminalAgentSnapshot } from '../shared/types'

const NORMAL_SCREEN_TAIL_LINES = 500
const RED_COLORS = new Set([1, 9])
const GREEN_COLORS = new Set([2, 10])
const YELLOW_COLORS = new Set([3, 11])

export function readRenderedLinesRange(
  terminal: HeadlessTerminal,
  startRow: number,
  endRow: number
): string {
  return readRenderedLines(terminal, startRow, endRow).join('\n')
}

export function readAgentSnapshot(terminal: HeadlessTerminal): TerminalAgentSnapshot {
  const buffer = terminal.buffer.active
  const isFullscreen = buffer.type === 'alternate'
  const startRow = isFullscreen
    ? buffer.viewportY
    : Math.max(0, buffer.baseY + terminal.rows - NORMAL_SCREEN_TAIL_LINES)
  const endRow = isFullscreen ? buffer.viewportY + terminal.rows - 1 : buffer.baseY + terminal.rows - 1
  const lines = readRenderedLinesWithAttrs(terminal, startRow, endRow)
  const visualHints = isFullscreen
    ? lines.filter((line) => line.text && line.attrs.length > 0).map(({ text, attrs }) => ({ text, attrs }))
    : []
  const cursorLine = buffer
    .getLine(buffer.baseY + buffer.cursorY)
    ?.translateToString(true)
    .trimEnd()

  return {
    screen: lines.map((line) => line.text).join('\n'),
    ...(isFullscreen && { isFullscreen }),
    ...(cursorLine && { cursorLine }),
    ...(visualHints.length > 0 && { visualHints })
  }
}

function readRenderedLines(terminal: HeadlessTerminal, startRow: number, endRow: number): string[] {
  return readRenderedLinesWithAttrs(terminal, startRow, endRow).map((line) => line.text)
}

function readRenderedLinesWithAttrs(
  terminal: HeadlessTerminal,
  startRow: number,
  endRow: number
): Array<{ text: string; attrs: string[] }> {
  const buffer = terminal.buffer.active
  const lines: Array<{ text: string; attrs: string[] }> = []

  for (let row = startRow; row <= endRow; row++) {
    const line = buffer.getLine(row)
    lines.push(line ? readLine(line) : { text: '', attrs: [] })
  }

  return trimOuterEmptyLines(lines)
}

function readLine(line: IBufferLine): { text: string; attrs: string[] } {
  const attrs = new Set<string>()
  for (let column = 0; column < line.length; column++) {
    const cell = line.getCell(column)
    if (!cell || cell.getWidth() === 0 || !cell.getChars()) continue
    for (const attr of cellAttrs(cell)) attrs.add(attr)
  }
  return {
    text: line.translateToString(true).trimEnd(),
    attrs: [...attrs]
  }
}

function cellAttrs(cell: IBufferCell): string[] {
  const attrs: string[] = []
  const fgColor = cell.getFgColor()
  const hasKnownColor =
    cell.isFgPalette() && (RED_COLORS.has(fgColor) || YELLOW_COLORS.has(fgColor) || GREEN_COLORS.has(fgColor))
  if (cell.isInverse()) attrs.push('inverse')
  if (cell.isFgPalette() && RED_COLORS.has(fgColor)) attrs.push('red')
  if (cell.isFgPalette() && YELLOW_COLORS.has(fgColor)) attrs.push('yellow')
  if (cell.isFgPalette() && GREEN_COLORS.has(fgColor)) attrs.push('green')
  if ((!cell.isFgDefault() || !cell.isBgDefault()) && !hasKnownColor) attrs.push('colored')
  if (cell.isDim()) attrs.push('dim')
  if (cell.isBold()) attrs.push('bold')
  return attrs
}

export function trimOuterEmptyLines<T extends string | { text: string }>(lines: T[]): T[] {
  let start = 0
  let end = lines.length
  while (start < end && lineText(lines[start]) === '') start++
  while (end > start && lineText(lines[end - 1]) === '') end--
  return lines.slice(start, end)
}

function lineText(line: string | { text: string }): string {
  return typeof line === 'string' ? line : line.text
}
