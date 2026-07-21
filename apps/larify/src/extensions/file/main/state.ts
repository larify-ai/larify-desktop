import { createKeyedLock } from "../../../main/utils/lock"

const fileStates = new Map<string, Map<string, number>>()

export function fileStateFor(sessionId: string): Map<string, number> {
  let state = fileStates.get(sessionId)
  if (!state) {
    state = new Map()
    fileStates.set(sessionId, state)
  }
  return state
}

export const withFileLock = createKeyedLock()
