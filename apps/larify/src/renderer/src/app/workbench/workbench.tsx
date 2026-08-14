import { useLayoutEffect, useRef, useState } from 'react'
import type { Resource } from '@shared/resource'
import { Region } from '../layout/region'
import { createWorkbenchStore } from './workbench-store'
import { WorkbenchShell } from './workbench-shell'

export function Workbench({
  sessionId,
  cwd,
  resources
}: {
  sessionId: string
  cwd: string
  resources?: Resource[]
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
    if (resources) {
      store.getState().syncResources(resources)
      return
    }

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
  }, [resources, sessionId, store])

  const openTool = (id: string): void => {
    void window.bridge
      .invoke(
        'resource:create',
        id,
        sessionId,
        id === 'terminal' && cwd ? { cwd } : id === 'workspace' ? { root: cwd } : {}
      )
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
        <WorkbenchShell cwd={cwd} store={store} sessionId={sessionId} onOpenTool={openTool} />
      </aside>
    </Region>
  )
}

export function WorkbenchHost({
  activeId,
  sessions
}: {
  activeId: string
  sessions: Array<{ cwd: string; id: string }>
}): React.JSX.Element {
  const [resources, setResources] = useState<Resource[]>([])

  useLayoutEffect(() => {
    let active = true
    let hasResourceChange = false
    const unbindChange = window.bridge.on('resource:change', (value) => {
      if (!active) return
      hasResourceChange = true
      setResources(value as Resource[])
    })
    void window.bridge
      .invoke('resource:list')
      .then((value) => {
        if (active && !hasResourceChange) setResources(value as Resource[])
      })
      .catch(() => undefined)
    return () => {
      active = false
      unbindChange()
    }
  }, [])

  const sessionIdsWithResources = new Set(resources.map((resource) => resource.sessionId))
  return (
    <div className="h-full">
      {sessions.map((session) => {
        if (session.id !== activeId && !sessionIdsWithResources.has(session.id)) return null
        return (
          <div
            className={session.id === activeId ? 'h-full' : 'hidden'}
            data-active={session.id === activeId || undefined}
            data-workbench-session={session.id}
            key={session.id}
          >
            <Workbench
              cwd={session.cwd}
              resources={resources.filter((resource) => resource.sessionId === session.id)}
              sessionId={session.id}
            />
          </div>
        )
      })}
    </div>
  )
}
