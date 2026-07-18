import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { TerminalAgentSnapshot } from '../shared/types'

const NORMAL_SCREEN_TAIL_LINES = 2000

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

  return {
    screen: readRenderedLines(terminal, startRow, endRow).join('\n'),
    ...(isFullscreen && { isFullscreen })
  }
}

export function readAgentOutputSince(
  terminal: HeadlessTerminal,
  startRow: number
): TerminalAgentSnapshot & { endRow: number } {
  const buffer = terminal.buffer.active
  if (buffer.type === 'alternate') {
    const snapshot = readAgentSnapshot(terminal)
    return {
      ...snapshot,
      endRow: buffer.viewportY + terminal.rows - 1
    }
  }

  const endRow = buffer.baseY + terminal.rows - 1
  return {
    screen: readRenderedLines(terminal, startRow, endRow).join('\n'),
    endRow
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

export function trimOuterEmptyLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start] === '') start++
  while (end > start && lines[end - 1] === '') end--
  return lines.slice(start, end)
}
