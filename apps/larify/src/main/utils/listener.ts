export type Listener<T extends unknown[]> = (...args: T) => void

export const addListener = <T extends unknown[]>(
  listeners: Set<Listener<T>>,
  listener: Listener<T>,
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
