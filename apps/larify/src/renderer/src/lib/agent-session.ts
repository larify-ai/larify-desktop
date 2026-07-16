import { useSyncExternalStore } from "react"

const STORAGE_KEY = "larify.activeSessionId"

const createSessionId = (): string => crypto.randomUUID()

const readStoredSessionId = (): string | null => {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

const writeStoredSessionId = (sessionId: string): void => {
  try {
    localStorage.setItem(STORAGE_KEY, sessionId)
  } catch {
  }
}

let currentSessionId: string = readStoredSessionId() ?? createSessionId()
writeStoredSessionId(currentSessionId)
const listeners = new Set<() => void>()

export function getAgentSessionId(): string {
  return currentSessionId
}

export function setAgentSessionId(sessionId: string): void {
  if (currentSessionId === sessionId) return
  currentSessionId = sessionId
  writeStoredSessionId(sessionId)
  for (const listener of listeners) listener()
}

export function useAgentSessionId(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => currentSessionId,
  )
}
