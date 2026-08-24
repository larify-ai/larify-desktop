/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore } from 'react'

export interface WorkbenchActivationStore {
  getSnapshot(): boolean
  set(active: boolean): void
  subscribe(listener: () => void): () => void
}

const ActivationContext = createContext<WorkbenchActivationStore | null>(null)

const createActivationStore = (initial: boolean): WorkbenchActivationStore => {
  let active = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => active,
    set(next) {
      if (active === next) return
      active = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

export function WorkbenchActivationProvider({
  active,
  children
}: {
  active: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [store] = useState(() => createActivationStore(active))
  useLayoutEffect(() => store.set(active), [active, store])
  return <ActivationContext value={store}>{children}</ActivationContext>
}

export function useWorkbenchActivation(fallback = true): boolean {
  const store = useContext(ActivationContext)
  return useSyncExternalStore(
    store?.subscribe ?? (() => () => undefined),
    store?.getSnapshot ?? (() => fallback),
    store?.getSnapshot ?? (() => fallback)
  )
}

export function useWorkbenchActivationStore(): WorkbenchActivationStore | null {
  return useContext(ActivationContext)
}
