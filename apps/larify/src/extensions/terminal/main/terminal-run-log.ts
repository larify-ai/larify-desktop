import { appendFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { larifyPath } from '../../../main/utils/app-paths'
import { createUniqueFile, shortToken } from '../../../main/utils/unique-path'

export interface TerminalRunLog {
  runId: string
  sessionId: string
  path?: string
}

export function createTerminalRunLog(sessionId: string): TerminalRunLog {
  return {
    runId: shortToken(),
    sessionId
  }
}

export async function appendRunLog(log: TerminalRunLog, output: string): Promise<void> {
  if (!output) return
  if (!log.path) {
    log.path = createUniqueFile(
      larifyPath('sessions', log.sessionId, 'terminals'),
      'log',
      log.runId
    )
    log.runId = basename(log.path, '.log')
  }
  await appendFile(log.path, `${output}\n`, 'utf8')
}
