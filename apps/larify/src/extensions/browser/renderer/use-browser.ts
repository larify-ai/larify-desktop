import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAgentSessionId } from "@renderer/lib/agent-session"
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
  const sessionId = useAgentSessionId()
  const [state, setState] = useState<BrowserState>(EMPTY)
  const suppressAutoCreateRef = useRef(false)
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const currentSessionIdRef = useRef(sessionId)

  const refreshState = useCallback(async (): Promise<void> => {
    const requestedSessionId = sessionId
    const value = await window.bridge.invoke("browser:getState", sessionId)
    if (currentSessionIdRef.current !== requestedSessionId) return
    const next = (value as BrowserState | null) ?? EMPTY
    setLoadedSessionId(sessionId)
    setState(next)
  }, [sessionId])

  useEffect(() => {
    let alive = true
    currentSessionIdRef.current = sessionId
    suppressAutoCreateRef.current = false
    setLoadedSessionId(null)
    setState(EMPTY)
    void window.bridge.invoke("browser:getState", sessionId).then((value) => {
      if (!alive) return
      const next = (value as BrowserState | null) ?? EMPTY
      setLoadedSessionId(sessionId)
      setState(next)
    })
    const off = window.bridge.on("browser:state", (value) => {
      const event = value as { sessionId?: string; state?: BrowserState }
      if (event.sessionId !== sessionId || !event.state) return
      setLoadedSessionId(sessionId)
      setState(event.state)
    })
    return () => {
      alive = false
      off()
    }
  }, [sessionId])

  useEffect(() => {
    if (!workbenchVisible) return
    void refreshState()
  }, [refreshState, workbenchVisible])

  useEffect(() => {
    const onActive = (event: Event): void => {
      const visible = (event as CustomEvent<string | null>).detail === "browser"
      setWorkbenchVisible(visible)
      if (!visible) suppressAutoCreateRef.current = false
    }
    window.addEventListener("larify:workbench-active", onActive)
    window.dispatchEvent(new Event("larify:workbench-active-request"))
    return () => window.removeEventListener("larify:workbench-active", onActive)
  }, [])

  useEffect(() => {
    if (!workbenchVisible) return
    if (loadedSessionId !== sessionId) return
    if (state.tabs.length > 0) return
    if (suppressAutoCreateRef.current) return
    void window.bridge.invoke("browser:ensureTab", sessionId)
  }, [loadedSessionId, sessionId, state.tabs.length, workbenchVisible])

  const actions = useMemo(
    () => ({
      back: (id: number) => window.bridge.invoke("browser:back", sessionId, id) as Promise<void>,
      close: async (id: number) => {
        const closingLastTab = state.tabs.length <= 1
        if (closingLastTab) suppressAutoCreateRef.current = true
        let next: BrowserState | undefined
        try {
          next = (await window.bridge.invoke("browser:close", sessionId, id)) as
            | BrowserState
            | undefined
        } catch (error) {
          if (closingLastTab) suppressAutoCreateRef.current = false
          throw error
        }
        if (closingLastTab && (!next || next.tabs.length === 0)) {
          window.dispatchEvent(new CustomEvent("larify:workbench-close", { detail: "browser" }))
        } else if (closingLastTab) {
          suppressAutoCreateRef.current = false
        }
      },
      create: (url?: string) => window.bridge.invoke("browser:create", sessionId, url) as Promise<number>,
      forward: (id: number) => window.bridge.invoke("browser:forward", sessionId, id) as Promise<void>,
      navigate: (id: number, url: string) =>
        window.bridge.invoke("browser:navigate", sessionId, id, url) as Promise<boolean>,
      reload: (id: number) => window.bridge.invoke("browser:reload", sessionId, id) as Promise<void>,
      reorder: (id: number, toIndex: number) =>
        window.bridge.invoke("browser:reorder", sessionId, id, toIndex) as Promise<void>,
      setActive: (id: number) => window.bridge.invoke("browser:setActive", sessionId, id) as Promise<void>,
    }),
    [sessionId, state.tabs.length],
  )

  const active = useMemo(() => state.tabs.find((tab) => tab.id === state.activeId) ?? null, [state])

  return { state, active, ...actions }
}
