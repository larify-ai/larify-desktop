import { useLayoutEffect, useRef, useState } from 'react'
import type { Resource } from '@shared/resource'
import { Region } from '../layout/region'
import { createWorkbenchStore } from './workbench-store'
import { WorkbenchShell } from './workbench-shell'

export function Workbench({
  sessionId,
  cwd
}: {
  sessionId: string
  cwd: string
}): React.JSX.Element {
  const [stores] = useState(() => new Map<string, ReturnType<typeof createWorkbenchStore>>())
  let store = stores.get(sessionId)
  if (!store) {
    store = createWorkbenchStore()
    stores.set(sessionId, store)
  }
  const sessionIdRef = useRef(sessionId)
  useLayoutEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useLayoutEffect(() => {
    let active = true
    let hasResourceChange = false
    const sync = (resources: Resource[]): void =>
      store
        .getState()
        .syncResources(resources.filter((resource) => resource.sessionId === sessionId))
    const unbindChange = window.bridge.on('resource:change', (value) => {
      if (!active) return
      hasResourceChange = true
      sync(value as Resource[])
    })
    void window.bridge
      .invoke('resource:list', { sessionId })
      .then((value) => {
        if (active && !hasResourceChange) sync(value as Resource[])
      })
      .catch(() => undefined)
    return () => {
      active = false
      unbindChange()
    }
  }, [sessionId, store])

  const openTool = (id: string): void => {
    void window.bridge
      .invoke('resource:create', id, sessionId, id === 'terminal' && cwd ? { cwd } : {})
      .then((resourceId: number) => {
        if (sessionIdRef.current === sessionId) {
          store.getState().openView({ rendererId: id, resourceId })
        }
      })
      .catch(() => undefined)
  }

  return (
    <Region label="Workbench" className="h-full min-w-0 overflow-hidden">
      <aside aria-label="Workbench content" className="h-full">
        <WorkbenchShell store={store} sessionId={sessionId} onOpenTool={openTool} />
      </aside>
    </Region>
  )
}
