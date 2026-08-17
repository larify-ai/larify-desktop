import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Resource } from '@shared/resource'
import { Region } from '../layout/region'
import { createWorkbenchStore } from './workbench-store'
import { WorkbenchShell } from './workbench-shell'

const resourceOptions = (id: string, cwd: string): Record<string, string> => {
  if (id === 'terminal') return cwd ? { cwd } : {}
  if (id === 'workspace' || id === 'changes') return { root: cwd }
  return {}
}

const optionsKey = (options: Record<string, string>): string =>
  JSON.stringify(Object.entries(options).sort(([first], [second]) => first.localeCompare(second)))

export function Workbench({
  active = true,
  sessionId,
  cwd,
  resources
}: {
  active?: boolean
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
  const pendingTools = useRef(new Map<string, Promise<number | null>>())
  const scopedTools = useRef(new Map<string, number>())
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

  useLayoutEffect(() => {
    const selectResource = (event: Event): void => {
      const detail = (
        event as CustomEvent<{
          rendererId?: string
          resourceId?: number
          sessionId?: string
        }>
      ).detail
      if (
        detail?.sessionId !== sessionId ||
        !detail.rendererId ||
        typeof detail.resourceId !== 'number'
      )
        return
      store.getState().openView({ rendererId: detail.rendererId, resourceId: detail.resourceId })
    }
    window.addEventListener('larify:workbench-select-resource', selectResource)
    return () => window.removeEventListener('larify:workbench-select-resource', selectResource)
  }, [sessionId, store])

  const createTool = useCallback(
    (id: string, options?: Record<string, string>): Promise<number | null> =>
      window.bridge
        .invoke('resource:create', id, sessionId, { ...resourceOptions(id, cwd), ...options })
        .then((resourceId: number) => {
          if (sessionIdRef.current === sessionId) {
            store.getState().openView({ rendererId: id, resourceId })
            return resourceId
          }
          return null
        })
        .catch(() => null),
    [cwd, sessionId, store]
  )

  const runAfterOpen = useCallback(
    (rendererId: string, resourceId: number, onOpen?: (resourceId: number) => void): void => {
      if (!onOpen) return
      window.setTimeout(() => {
        const available = store
          .getState()
          .views.some((view) => view.rendererId === rendererId && view.resourceId === resourceId)
        if (sessionIdRef.current === sessionId && available) onOpen(resourceId)
      }, 0)
    },
    [sessionId, store]
  )

  const openTool = useCallback(
    (id: string): void => {
      void createTool(id)
    },
    [createTool]
  )

  const openWorkbenchTool = useCallback(
    (
      rendererId: string,
      onOpen?: (resourceId: number) => void,
      options?: Record<string, string>
    ): void => {
      const defaults = resourceOptions(rendererId, cwd)
      const resolvedOptions = { ...defaults, ...options }
      const scoped = options !== undefined && optionsKey(resolvedOptions) !== optionsKey(defaults)
      const key = `${sessionId}:${rendererId}:${optionsKey(resolvedOptions)}`
      const scopedResourceId = scoped ? scopedTools.current.get(key) : undefined
      const views = store.getState().views
      const existing = scoped
        ? views.findLast(
            (view) => view.rendererId === rendererId && view.resourceId === scopedResourceId
          )
        : views.findLast((view) => view.rendererId === rendererId)
      if (existing) {
        store.getState().openView({ rendererId, resourceId: existing.resourceId })
        onOpen?.(existing.resourceId)
        return
      }
      let pending = pendingTools.current.get(key)
      if (!pending) {
        pending = createTool(rendererId, resolvedOptions)
        pendingTools.current.set(key, pending)
        void pending.finally(() => pendingTools.current.delete(key))
      }
      void pending.then((resourceId) => {
        if (resourceId === null) return
        if (scoped) scopedTools.current.set(key, resourceId)
        runAfterOpen(rendererId, resourceId, onOpen)
      })
    },
    [createTool, cwd, runAfterOpen, sessionId, store]
  )

  useLayoutEffect(() => {
    const openWorkbench = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!active) return
      if (typeof detail === 'string') {
        openWorkbenchTool(detail)
      } else if (detail && typeof detail === 'object' && 'rendererId' in detail) {
        const { onOpen, options, rendererId } = detail as {
          onOpen?: unknown
          options?: unknown
          rendererId?: unknown
        }
        if (typeof rendererId === 'string') {
          openWorkbenchTool(
            rendererId,
            typeof onOpen === 'function' ? (onOpen as (resourceId: number) => void) : undefined,
            options && typeof options === 'object' ? (options as Record<string, string>) : undefined
          )
        }
      }
    }
    window.addEventListener('larify:workbench-open', openWorkbench)
    return () => window.removeEventListener('larify:workbench-open', openWorkbench)
  }, [active, openWorkbenchTool])

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
              active={session.id === activeId}
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
