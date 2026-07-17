import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { larifyPath } from '../../../main/utils/app-paths'

export interface TerminalRunLog {
  runId: string
  path: string
}

export function createTerminalRunLog(sessionId: string): TerminalRunLog {
  const runId = randomUUID()
  return {
    runId,
    path: larifyPath('sessions', sessionId, 'terminals', `${runId}.log`)
  }
}

export async function appendRunLog(log: TerminalRunLog, output: string): Promise<void> {
  if (!output) return
  await mkdir(dirname(log.path), { recursive: true })
  await appendFile(log.path, `${output}\n`, 'utf8')
}
