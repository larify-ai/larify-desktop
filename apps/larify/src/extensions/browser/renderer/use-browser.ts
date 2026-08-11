import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { BrowserState, BrowserTabState } from '../shared/types'

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

export function useBrowser(sessionId: string): UseBrowser {
  const [state, setState] = useState<BrowserState>(EMPTY)
  const stateRef = useRef<BrowserState>(EMPTY)
  const suppressAutoCreateRef = useRef(false)
  const closingTabIdsRef = useRef(new Set<number>())
  const pendingCloseIdsRef = useRef(new Set<number>())
  const closeDispatchedRef = useRef(false)
  const closeEpochRef = useRef(0)
  const [loadedSessionId, setLoadedSessionId] = useState<string | null>(null)
  const loadedSessionIdRef = useRef<string | null>(null)
  const [workbenchVisible, setWorkbenchVisible] = useState(false)
  const currentSessionIdRef = useRef(sessionId)
  const nextStateSequenceRef = useRef(0)
  const appliedStateSequenceRef = useRef(0)
  const stateLoadFailuresRef = useRef(0)
  const stateLoadRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [stateLoadRetry, setStateLoadRetry] = useState<{
    sessionId: string
    sequence: number
  } | null>(null)
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
    stateLoadRetryTimerRef.current = setTimeout(
      () => {
        stateLoadRetryTimerRef.current = null
        if (currentSessionIdRef.current !== requestedSessionId) return
        setStateLoadRetry((current) => ({
          sessionId: requestedSessionId,
          sequence: current?.sessionId === requestedSessionId ? current.sequence + 1 : 1
        }))
      },
      Math.min(250 * 2 ** (failure - 1), 30_000)
    )
  }, [])

  const refreshState = useCallback(async (): Promise<void> => {
    const requestedSessionId = sessionId
    const requestSequence = ++nextStateSequenceRef.current
    const value = await window.bridge.invoke('browser:getState', sessionId)
    if (currentSessionIdRef.current !== requestedSessionId) return
    if (requestSequence < appliedStateSequenceRef.current) return
    clearStateLoadRetry()
    appliedStateSequenceRef.current = requestSequence
    const next = (value as BrowserState | null) ?? EMPTY
    stateRef.current = next
    loadedSessionIdRef.current = sessionId
    setLoadedSessionId(sessionId)
    setState(next)
  }, [clearStateLoadRetry, sessionId])

  useEffect(() => {
    let alive = true
    const closeEpoch = ++closeEpochRef.current
    currentSessionIdRef.current = sessionId
    suppressAutoCreateRef.current = false
    clearStateLoadRetry()
    ensureFailuresRef.current = 0
    loadedSessionIdRef.current = null
    stateRef.current = EMPTY
    closingTabIdsRef.current.clear()
    pendingCloseIdsRef.current.clear()
    closeDispatchedRef.current = false
    const requestSequence = ++nextStateSequenceRef.current
    void window.bridge
      .invoke('browser:getState', sessionId)
      .then((value) => {
        if (!alive) return
        if (requestSequence < appliedStateSequenceRef.current) return
        clearStateLoadRetry()
        appliedStateSequenceRef.current = requestSequence
        const next = (value as BrowserState | null) ?? EMPTY
        stateRef.current = next
        loadedSessionIdRef.current = sessionId
        setLoadedSessionId(sessionId)
        setState(next)
      })
      .catch(() => {
        if (alive) scheduleStateLoadRetry(sessionId)
      })
    const off = window.bridge.on('browser:state', (value) => {
      const event = value as { sessionId?: string; state?: BrowserState }
      if (event.sessionId !== sessionId || !event.state) return
      clearStateLoadRetry()
      setStateLoadRetry(null)
      appliedStateSequenceRef.current = ++nextStateSequenceRef.current
      loadedSessionIdRef.current = sessionId
      setLoadedSessionId(sessionId)
      stateRef.current = event.state
      setState(event.state)
    })
    return () => {
      alive = false
      if (closeEpochRef.current === closeEpoch) closeEpochRef.current++
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
      const visible = (event as CustomEvent<string | null>).detail === 'browser'
      setWorkbenchVisible(visible)
      if (!visible) suppressAutoCreateRef.current = false
    }
    window.addEventListener('larify:workbench-active', onActive)
    window.dispatchEvent(new Event('larify:workbench-active-request'))
    return () => window.removeEventListener('larify:workbench-active', onActive)
  }, [])

  useEffect(() => {
    if (!workbenchVisible) return
    if (loadedSessionId !== sessionId) return
    if (state.tabs.length > 0) return
    if (suppressAutoCreateRef.current) return
    let alive = true
    let retry: ReturnType<typeof setTimeout> | undefined
    void window.bridge
      .invoke('browser:ensureTab', sessionId)
      .then(() => {
        if (!alive || currentSessionIdRef.current !== sessionId) return
        ensureFailuresRef.current = 0
      })
      .catch(() => {
        if (!alive || currentSessionIdRef.current !== sessionId) return
        const failure = Math.min(ensureFailuresRef.current + 1, 8)
        ensureFailuresRef.current = failure
        retry = setTimeout(
          () => {
            if (alive) setEnsureRetry((value) => value + 1)
          },
          Math.min(250 * 2 ** (failure - 1), 30_000)
        )
      })
    return () => {
      alive = false
      if (retry) clearTimeout(retry)
    }
  }, [ensureRetry, loadedSessionId, sessionId, state.tabs.length, workbenchVisible])

  const actions = useMemo(
    () => ({
      back: (id: number) => window.bridge.invoke('browser:back', sessionId, id) as Promise<void>,
      close: async (id: number) => {
        const closeEpoch = closeEpochRef.current
        const closing = closingTabIdsRef.current
        const pendingClosing = pendingCloseIdsRef.current
        if (pendingClosing.size === 0) {
          closing.clear()
          closeDispatchedRef.current = false
        }
        closing.add(id)
        pendingClosing.add(id)
        const allCurrentTabsClosing =
          stateRef.current.tabs.length > 0 &&
          stateRef.current.tabs.every((tab) => closing.has(tab.id))
        if (allCurrentTabsClosing) suppressAutoCreateRef.current = true
        let next: BrowserState | undefined
        try {
          next = (await window.bridge.invoke('browser:close', sessionId, id)) as
            BrowserState | undefined
        } catch (error) {
          if (closeEpochRef.current !== closeEpoch) throw error
          closing.delete(id)
          pendingClosing.delete(id)
          const stillClosingAll =
            stateRef.current.tabs.length > 0 &&
            stateRef.current.tabs.every((tab) => closing.has(tab.id))
          if (!stillClosingAll) suppressAutoCreateRef.current = false
          if (pendingClosing.size === 0) closing.clear()
          throw error
        }
        if (closeEpochRef.current !== closeEpoch) return
        const latestHasNewTab = stateRef.current.tabs.some((tab) => !closing.has(tab.id))
        const shouldCloseWorkbench =
          (!next || next.tabs.length === 0) && !latestHasNewTab && !closeDispatchedRef.current
        pendingClosing.delete(id)
        if (shouldCloseWorkbench) {
          closeDispatchedRef.current = true
          window.dispatchEvent(new CustomEvent('larify:workbench-close', { detail: 'browser' }))
        } else {
          const remainingTabs = next?.tabs ?? stateRef.current.tabs
          const stillClosingAll =
            remainingTabs.length > 0 && remainingTabs.every((tab) => closing.has(tab.id))
          if (!stillClosingAll) suppressAutoCreateRef.current = false
        }
        if (pendingClosing.size === 0) closing.clear()
      },
      create: (url?: string) =>
        window.bridge.invoke('browser:create', sessionId, url) as Promise<number>,
      forward: (id: number) =>
        window.bridge.invoke('browser:forward', sessionId, id) as Promise<void>,
      navigate: (id: number, url: string) =>
        window.bridge.invoke('browser:navigate', sessionId, id, url) as Promise<boolean>,
      reload: (id: number) =>
        window.bridge.invoke('browser:reload', sessionId, id) as Promise<void>,
      reorder: (id: number, toIndex: number) =>
        window.bridge.invoke('browser:reorder', sessionId, id, toIndex) as Promise<void>,
      setActive: (id: number) =>
        window.bridge.invoke('browser:setActive', sessionId, id) as Promise<void>
    }),
    [sessionId]
  )

  const visibleState = loadedSessionId === sessionId ? state : EMPTY
  const active = useMemo(
    () => visibleState.tabs.find((tab) => tab.id === visibleState.activeId) ?? null,
    [visibleState]
  )

  return { state: visibleState, active, ...actions }
}
