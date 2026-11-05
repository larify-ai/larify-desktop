import { createKeyedLock } from '../../../main/utils/lock'

const MAX_SESSIONS = 100
const fileStates = new Map<string, Map<string, number>>()
const lock = createKeyedLock()

function stateFor(sessionId: string): Map<string, number> {
  const existing = fileStates.get(sessionId)
  if (existing) {
    fileStates.delete(sessionId)
    fileStates.set(sessionId, existing)
    return existing
  }
  const state = new Map<string, number>()
  fileStates.set(sessionId, state)
  while (fileStates.size > MAX_SESSIONS) {
    fileStates.delete(fileStates.keys().next().value as string)
  }
  return state
}

export function markRead(sessionId: string, target: string, mtimeMs: number): void {
  stateFor(sessionId).set(target, Math.floor(mtimeMs))
}

export function readAtFor(sessionId: string, target: string): number | undefined {
  return fileStates.get(sessionId)?.get(target)
}

const clearedListeners = new Set<(sessionId: string) => void>()

/** 订阅「会话读取状态被清空」（reset context / 删除会话）。 */
export function onReadStateCleared(listener: (sessionId: string) => void): () => void {
  clearedListeners.add(listener)
  return () => clearedListeners.delete(listener)
}

export function clearReadState(sessionId: string): void {
  fileStates.delete(sessionId)
  for (const listener of clearedListeners) listener(sessionId)
}

export function withFileLock<T>(target: string, run: () => Promise<T>): Promise<T> {
  return lock(target, run)
}
