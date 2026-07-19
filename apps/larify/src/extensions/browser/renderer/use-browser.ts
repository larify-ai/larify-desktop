import { useEffect, useMemo, useState } from "react"
import type { BrowserState, BrowserTabState } from "../shared/types"

const EMPTY: BrowserState = { tabs: [], activeId: null }

export interface UseBrowser {
  active: BrowserTabState | null
  state: BrowserState
  back(id: number): Promise<void>
  close(id: number): Promise<void>
  create(url?: string): Promise<number>
  forward(id: number): Promise<void>
  navigate(id: number, url: string): Promise<boolean>
  reload(id: number): Promise<void>
  reorder(id: number, toIndex: number): Promise<void>
  setActive(id: number): Promise<void>
}

export function useBrowser(): UseBrowser {
  const [state, setState] = useState<BrowserState>(EMPTY)

  useEffect(() => {
    let alive = true
    void window.bridge.invoke("browser:getState").then((value) => {
      if (!alive) return
      const next = (value as BrowserState | null) ?? EMPTY
      setState(next)
      if (next.tabs.length === 0) void window.bridge.invoke("browser:create")
    })
    const off = window.bridge.on("browser:state", (value) => {
      setState(value as BrowserState)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const actions = useMemo(
    () => ({
      back: (id: number) => window.bridge.invoke("browser:back", id) as Promise<void>,
      close: (id: number) => window.bridge.invoke("browser:close", id) as Promise<void>,
      create: (url?: string) => window.bridge.invoke("browser:create", url) as Promise<number>,
      forward: (id: number) => window.bridge.invoke("browser:forward", id) as Promise<void>,
      navigate: (id: number, url: string) =>
        window.bridge.invoke("browser:navigate", id, url) as Promise<boolean>,
      reload: (id: number) => window.bridge.invoke("browser:reload", id) as Promise<void>,
      reorder: (id: number, toIndex: number) =>
        window.bridge.invoke("browser:reorder", id, toIndex) as Promise<void>,
      setActive: (id: number) => window.bridge.invoke("browser:setActive", id) as Promise<void>,
    }),
    [],
  )

  const active = useMemo(() => state.tabs.find((tab) => tab.id === state.activeId) ?? null, [state])

  return { state, active, ...actions }
}
