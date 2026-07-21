import AsyncLock from "async-lock"

export type KeyedLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>

export function createKeyedLock(): KeyedLock {
  const lock = new AsyncLock()
  return (key, fn) => lock.acquire(key, fn)
}
