const fileStates = new Map<string, Map<string, number>>()

export function fileStateFor(sessionId: string): Map<string, number> {
  let state = fileStates.get(sessionId)
  if (!state) {
    state = new Map()
    fileStates.set(sessionId, state)
  }
  return state
}

const locks = new Map<string, Promise<unknown>>()

export function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(path) ?? Promise.resolve()).then(fn, fn)
  locks.set(
    path,
    run.catch(() => {}),
  )
  return run
}
