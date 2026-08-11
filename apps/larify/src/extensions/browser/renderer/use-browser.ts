import { useEffect, useState } from 'react'
import type { BrowserState, BrowserTabState } from '../shared/types'

export interface UseBrowser {
  state: BrowserTabState | null
  back(): Promise<void>
  forward(): Promise<void>
  navigate(url: string): Promise<boolean>
  reload(): Promise<void>
}

interface BrowserSnapshot {
  resourceId: number
  sessionId: string
  state: BrowserTabState | null
}

export function useBrowser(sessionId: string, resourceId: number): UseBrowser {
  const [snapshot, setSnapshot] = useState<BrowserSnapshot>({ resourceId, sessionId, state: null })
  const state =
    snapshot.resourceId === resourceId && snapshot.sessionId === sessionId ? snapshot.state : null

  useEffect(() => {
    let active = true
    let receivedEvent = false
    const unsubscribe = window.bridge.on('browser:state', (value) => {
      if (!active) return
      const event = value as { sessionId?: string; state?: BrowserState }
      if (event.sessionId !== sessionId || !event.state) return
      receivedEvent = true
      setSnapshot({
        resourceId,
        sessionId,
        state: event.state.tabs.find(({ id }) => id === resourceId) ?? null
      })
    })
    void window.bridge
      .invoke('browser:getState', sessionId, resourceId)
      .then((value) => {
        if (active && !receivedEvent) {
          setSnapshot({ resourceId, sessionId, state: (value as BrowserTabState | null) ?? null })
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
      unsubscribe()
    }
  }, [resourceId, sessionId])

  const invoke = (channel: string, ...args: unknown[]): Promise<unknown> =>
    window.bridge.invoke(channel, sessionId, resourceId, ...args)

  return {
    state,
    back: () => invoke('browser:back') as Promise<void>,
    forward: () => invoke('browser:forward') as Promise<void>,
    navigate: (url) => invoke('browser:navigate', url) as Promise<boolean>,
    reload: () => invoke('browser:reload') as Promise<void>
  }
}
