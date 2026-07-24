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
  const loadedSessionIdRef = useRef<string | null>(null)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const currentSessionIdRef = useRef(sessionId)
  const nextStateSequenceRef = useRef(0)
  const appliedStateSequenceRef = useRef(0)
  const stateLoadFailuresRef = useRef(0)
  const stateLoadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stateLoadRetry, setStateLoadRetry] = useState<{ sessionId: string; sequence: number } | null>(
    null,
  )
  const ensureFailuresRef = useRef(0)
  const [ensureRetry, setEnsureRetry] = useState(0)

  const clearStateLoadRetry = useCallback((): void => {
    if (stateLoadRetryTimerRef.current) clearTimeout(stateLoadRetryTimerRef.current)
    stateLoadRetryTimerRef.current = null
    stateLoadFailuresRef.current = 0
  }, [])

  const scheduleStateLoadRetry = useCallback((requestedSessionId: string): void => {
    if (currentSessionIdRef.current !== requestedSessionId) return
    if (loadedSessionIdRef.current === requestedSessionId) return
    if (stateLoadRetryTimerRef.current) return
    const failure = Math.min(stateLoadFailuresRef.current + 1, 8)
    stateLoadFailuresRef.current = failure
    stateLoadRetryTimerRef.current = setTimeout(() => {
      stateLoadRetryTimerRef.current = null
      if (currentSessionIdRef.current !== requestedSessionId) return
      setStateLoadRetry((current) => ({
        sessionId: requestedSessionId,
        sequence: current?.sessionId === requestedSessionId ? current.sequence + 1 : 1,
      }))
    }, Math.min(250 * 2 ** (failure - 1), 30_000))
  }, [])

  const refreshState = useCallback(async (): Promise<void> => {
    const requestedSessionId = sessionId
    const requestSequence = ++nextStateSequenceRef.current
    const value = await window.bridge.invoke("browser:getState", sessionId)
    if (currentSessionIdRef.current !== requestedSessionId) return
    if (requestSequence < appliedStateSequenceRef.current) return
    clearStateLoadRetry()
    appliedStateSequenceRef.current = requestSequence
    const next = (value as BrowserState | null) ?? EMPTY
    loadedSessionIdRef.current = sessionId
    setLoadedSessionId(sessionId)
    setState(next)
  }, [clearStateLoadRetry, sessionId])

  useEffect(() => {
    let alive = true
    currentSessionIdRef.current = sessionId
    suppressAutoCreateRef.current = false
    clearStateLoadRetry()
    setStateLoadRetry(null)
    ensureFailuresRef.current = 0
    setEnsureRetry(0)
    loadedSessionIdRef.current = null
    setLoadedSessionId(null)
    setState(EMPTY)
    const requestSequence = ++nextStateSequenceRef.current
    void window.bridge
      .invoke("browser:getState", sessionId)
      .then((value) => {
        if (!alive) return
        if (requestSequence < appliedStateSequenceRef.current) return
        clearStateLoadRetry()
        appliedStateSequenceRef.current = requestSequence
        const next = (value as BrowserState | null) ?? EMPTY
        loadedSessionIdRef.current = sessionId
        setLoadedSessionId(sessionId)
        setState(next)
      })
      .catch(() => {
        if (alive) scheduleStateLoadRetry(sessionId)
      })
    const off = window.bridge.on("browser:state", (value) => {
      const event = value as { sessionId?: string; state?: BrowserState }
      if (event.sessionId !== sessionId || !event.state) return
      clearStateLoadRetry()
      setStateLoadRetry(null)
      appliedStateSequenceRef.current = ++nextStateSequenceRef.current
      loadedSessionIdRef.current = sessionId
      setLoadedSessionId(sessionId)
      setState(event.state)
    })
    return () => {
      alive = false
      if (stateLoadRetryTimerRef.current) clearTimeout(stateLoadRetryTimerRef.current)
      stateLoadRetryTimerRef.current = null
      off()
    }
  }, [clearStateLoadRetry, scheduleStateLoadRetry, sessionId])

  useEffect(() => {
    if (!workbenchVisible) return
    void refreshState().catch(() => scheduleStateLoadRetry(sessionId))
  }, [refreshState, scheduleStateLoadRetry, sessionId, workbenchVisible])

  useEffect(() => {
    if (stateLoadRetry?.sessionId !== sessionId) return
    if (loadedSessionId === sessionId) return
    void refreshState().catch(() => scheduleStateLoadRetry(sessionId))
  }, [loadedSessionId, refreshState, scheduleStateLoadRetry, sessionId, stateLoadRetry])

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
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    void window.bridge
      .invoke("browser:ensureTab", sessionId)
      .then(() => {
        if (!alive || currentSessionIdRef.current !== sessionId) return
        ensureFailuresRef.current = 0
      })
      .catch(() => {
        if (!alive || currentSessionIdRef.current !== sessionId) return
        const failure = Math.min(ensureFailuresRef.current + 1, 8)
        ensureFailuresRef.current = failure
        retry = setTimeout(() => {
          if (alive) setEnsureRetry((value) => value + 1)
        }, Math.min(250 * 2 ** (failure - 1), 30_000))
      })
    return () => {
      alive = false
      if (retry) clearTimeout(retry)
    }
  }, [ensureRetry, loadedSessionId, sessionId, state.tabs.length, workbenchVisible])

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
