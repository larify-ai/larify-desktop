import { createKeyedLock } from "../../../main/utils/lock"

const fileStates = new Map<string, Map<string, number>>()
const lock = createKeyedLock()

function stateFor(sessionId: string): Map<string, number> {
  let state = fileStates.get(sessionId)
  if (!state) {
    state = new Map()
    fileStates.set(sessionId, state)
  }
  return state
}

export function markRead(sessionId: string, target: string, mtimeMs: number): void {
  stateFor(sessionId).set(target, Math.floor(mtimeMs))
}

export function readAtFor(sessionId: string, target: string): number | undefined {
  return stateFor(sessionId).get(target)
}

export function withFileLock<T>(target: string, run: () => Promise<T>): Promise<T> {
  return lock(target, run)
}
