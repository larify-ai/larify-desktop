import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { TerminalAgentSnapshot } from '../shared/types'

export function readAgentSnapshot(
  terminal: HeadlessTerminal
): TerminalAgentSnapshot {
  const buffer = terminal.buffer.active
  const startRow = buffer.viewportY
  const endRow = buffer.viewportY + terminal.rows - 1
  const lines = readRenderedLines(terminal, startRow, endRow)
  const cursorLine = buffer
    .getLine(buffer.baseY + buffer.cursorY)
    ?.translateToString(true)
    .trimEnd()

  return {
    screen: lines.join('\n'),
    ...(cursorLine && { cursorLine })
  }
}

function readRenderedLines(terminal: HeadlessTerminal, startRow: number, endRow: number): string[] {
  const buffer = terminal.buffer.active
  const lines: string[] = []

  for (let row = startRow; row <= endRow; row++) {
    const line = buffer.getLine(row)
    lines.push(line?.translateToString(true).trimEnd() ?? '')
  }

  return trimOuterEmptyLines(lines)
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
