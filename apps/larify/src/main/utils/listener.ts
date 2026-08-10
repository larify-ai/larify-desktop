export type Listener<T extends unknown[]> = (...args: T) => void

export const addListener = <T extends unknown[]>(
  listeners: Set<Listener<T>>,
  listener: Listener<T>,
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notify<T extends unknown[]>(listeners: Set<Listener<T>>, ...args: T): void {
  for (const listener of listeners) {
    try {
      listener(...args)
    } catch {
      continue
    }
  }
}
