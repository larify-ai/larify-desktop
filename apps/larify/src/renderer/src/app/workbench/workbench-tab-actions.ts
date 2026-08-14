import { createContext, createElement, useContext, useLayoutEffect, type ReactNode } from 'react'

export const WorkbenchTabActionsContext = createContext<((actions: ReactNode) => void) | null>(null)

export function useWorkbenchTabActions(actions: ReactNode): void {
  const setActions = useContext(WorkbenchTabActionsContext)
  useLayoutEffect(() => {
    setActions?.(actions)
    return () => setActions?.(null)
  }, [actions, setActions])
}

export function WorkbenchTabActionScope({
  active,
  children
}: {
  active: boolean
  children: ReactNode
}): React.JSX.Element {
  const setActions = useContext(WorkbenchTabActionsContext)
  return createElement(
    WorkbenchTabActionsContext.Provider,
    { value: active ? setActions : null },
    children
  )
}
