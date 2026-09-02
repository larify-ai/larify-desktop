import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversationHeading } from './conversation-header'
import { AssistantSessionsContext, type AssistantSessionState } from './sessions-context'
import {
  loadSessionDirectory,
  loadSessionPage,
  type SessionDirectoryGroup
} from './session-directory'
import { loadMessagePage } from './session-messages'
import { SessionAttentionContext, type SessionAttentionState } from './session-attention'

function createSession(cwd = ''): AssistantSessionState {
  return {
    cwd,
    id: crypto.randomUUID(),
    heading: null,
    persisted: false,
    messages: [],
    messageCount: 0
  }
}

interface SessionsState {
  sessions: AssistantSessionState[]
  activeId: string
}

function createState(): SessionsState {
  const session = createSession()
  return { sessions: [session], activeId: session.id }
}

const closeSessionResources = async (sessionId: string): Promise<void> => {
  const resources = (await window.bridge.invoke('resource:list', { sessionId })) as Array<{
    id: number
  }>
  await Promise.allSettled(
    resources.map(({ id }) => window.bridge.invoke('resource:close', id) as Promise<unknown>)
  )
}

interface NavigationHistory {
  stack: string[]
  index: number
}

export function AssistantSessionsProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [state, setState] = useState(createState)
  const [directory, setDirectory] = useState<SessionDirectoryGroup[]>([])
  const [attention, setAttention] = useState(() => new Map<string, SessionAttentionState>())
  const refreshVersion = useRef(0)
  const loading = useRef(new Set<string>())
  const closingResources = useRef(new Set<string>())
  const selected = useRef(state.activeId)
  // 会话访问历史栈：记录用户通过侧边栏点击/新建访问过的会话顺序，用于前进/后退。
  const navRef = useRef<NavigationHistory | null>(null)
  if (navRef.current === null) navRef.current = { stack: [state.activeId], index: 0 }
  const [navTick, setNavTick] = useState(0)

  const recordVisit = useCallback((id: string): void => {
    const nav = navRef.current!
    if (nav.stack[nav.index] === id) return
    const incoming = nav.stack.indexOf(id)
    if (incoming >= 0) {
      // 目标会话已在历史中：把指针移回该位置（保留其后的前进分支），不新增重复条目。
      nav.index = incoming
    } else {
      // 新会话：丢弃当前位置之后的历史，再压入。
      nav.stack.length = nav.index + 1
      nav.stack.push(id)
      nav.index = nav.stack.length - 1
    }
    setNavTick((tick) => tick + 1)
  }, [])

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    const value = await loadSessionDirectory()
    if (version === refreshVersion.current) setDirectory(value)
  }, [])

  useEffect(() => {
    void refresh().catch(() => undefined)
  }, [refresh])

  const create = useCallback(
    (cwd = '') => {
      // 会话对象在 updater 外构造，保证 StrictMode double-invoke updater 时复用同一个
      // 稳定 id，避免记录历史时入栈一个不在 state 里的孤儿 id（back 会卡住）。recordVisit
      // 幂等（当前栈顶已是该 id 时直接返回），double-invoke 不会产生重复条目。
      const session = createSession(cwd)
      setState((current) => {
        const draft = current.sessions.find(({ persisted }) => !persisted)
        if (draft) {
          recordVisit(draft.id)
          selected.current = draft.id
          queueMicrotask(() => {
            if (closingResources.current.has(draft.id)) return
            closingResources.current.add(draft.id)
            void closeSessionResources(draft.id)
              .catch(() => undefined)
              .finally(() => closingResources.current.delete(draft.id))
          })
          return {
            sessions: current.sessions.map((item) =>
              item.id === draft.id ? { ...item, cwd } : item
            ),
            activeId: draft.id
          }
        }

        recordVisit(session.id)
        selected.current = session.id
        return { sessions: [...current.sessions, session], activeId: session.id }
      })
    },
    [recordVisit]
  )
  const applySelect = useCallback(
    async (activeId: string) => {
      const clearUnread = (): void => {
        setAttention((current) => {
          if (current.get(activeId) !== 'unread') return current
          const next = new Map(current)
          next.delete(activeId)
          return next
        })
      }
      if (state.sessions.some(({ id }) => id === activeId)) {
        selected.current = activeId
        clearUnread()
        setState((current) => ({ ...current, activeId }))
        return
      }

      const stored = directory.flatMap(({ sessions }) => sessions).find(({ id }) => id === activeId)
      if (!stored) return
      selected.current = activeId
      let page
      try {
        page = await loadMessagePage(activeId)
      } catch {
        if (selected.current === activeId) selected.current = state.activeId
        return
      }
      if (selected.current === activeId) clearUnread()
      setState((current) => {
        const existing = current.sessions.find(({ id }) => id === activeId)
        const sessions = existing
          ? current.sessions
          : [
              ...current.sessions,
              {
                cwd: stored.cwd,
                id: activeId,
                heading: { cwd: stored.cwd, title: stored.title },
                persisted: true,
                ...page
              }
            ]
        return { sessions, activeId: selected.current === activeId ? activeId : current.activeId }
      })
    },
    [directory, state.activeId, state.sessions]
  )

  const select = useCallback(
    async (id: string) => {
      recordVisit(id)
      await applySelect(id)
    },
    [applySelect, recordVisit]
  )
  const back = useCallback(() => {
    const nav = navRef.current!
    if (nav.index <= 0) return
    nav.index -= 1
    setNavTick((tick) => tick + 1)
    void applySelect(nav.stack[nav.index])
  }, [applySelect])
  const forward = useCallback(() => {
    const nav = navRef.current!
    if (nav.index >= nav.stack.length - 1) return
    nav.index += 1
    setNavTick((tick) => tick + 1)
    void applySelect(nav.stack[nav.index])
  }, [applySelect])
  const canBack = (navRef.current?.index ?? 0) > 0
  const canForward = (navRef.current?.index ?? 0) < (navRef.current?.stack.length ?? 1) - 1
  const loadMore = useCallback(
    async (cwd: string) => {
      const group = directory.find((item) => item.cwd === cwd)
      if (!group?.hasMore || loading.current.has(cwd)) return

      const ids = group.sessions.map(({ id }) => id)
      loading.current.add(cwd)
      try {
        const page = await loadSessionPage(cwd, ids.length)
        setDirectory((current) =>
          current.map((item) =>
            item.cwd === cwd &&
            item.sessions.length === ids.length &&
            item.sessions.every((session, index) => session.id === ids[index])
              ? {
                  ...item,
                  sessions: [
                    ...item.sessions,
                    ...page.sessions.filter(
                      (session) => !item.sessions.some(({ id }) => id === session.id)
                    )
                  ],
                  hasMore: page.hasMore
                }
              : item
          )
        )
      } catch {
        // Keep the page available for retry.
      } finally {
        loading.current.delete(cwd)
      }
    },
    [directory]
  )
  const setHeading = useCallback((id: string, heading: ConversationHeading | null) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, heading, cwd: heading?.cwd ?? session.cwd } : session
      )
    }))
  }, [])
  const rename = useCallback(async (id: string, title: string) => {
    const normalized = title.trim()
    if (!normalized) return
    await window.bridge.invoke('session:rename', id, normalized)
    setDirectory((current) =>
      current.map((group) => ({
        ...group,
        sessions: group.sessions.map((session) =>
          session.id === id ? { ...session, title: normalized } : session
        )
      }))
    )
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              heading: session.heading ? { ...session.heading, title: normalized } : null
            }
          : session
      )
    }))
  }, [])
  const setCwd = useCallback((id: string, cwd: string) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, cwd } : session
      )
    }))
  }, [])
  const setPersisted = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, persisted: true } : session
      )
    }))
  }, [])
  const attentionState = useCallback(
    (id: string): SessionAttentionState => attention.get(id) ?? 'idle',
    [attention]
  )
  const reportAttentionState = useCallback(
    (id: string, nextState: Exclude<SessionAttentionState, 'unread'>) => {
      setAttention((current) => {
        const previous = current.get(id) ?? 'idle'
        const resolved =
          nextState === 'idle' &&
          id !== selected.current &&
          (previous === 'active' || previous === 'waiting' || previous === 'unread')
            ? 'unread'
            : nextState
        if (previous === resolved) return current
        const next = new Map(current)
        if (resolved === 'idle') next.delete(id)
        else next.set(id, resolved)
        return next
      })
    },
    []
  )
  const activeSession = state.sessions.find(({ id }) => id === state.activeId)!
  const value = useMemo(
    () => ({
      ...state,
      directory,
      activeSession,
      create,
      select,
      back,
      forward,
      canBack,
      canForward,
      loadMore,
      refresh,
      rename,
      setCwd,
      setPersisted,
      setHeading,
      attentionState
    }),
    [
      activeSession,
      back,
      canBack,
      canForward,
      create,
      directory,
      forward,
      loadMore,
      navTick,
      refresh,
      rename,
      select,
      setCwd,
      setHeading,
      setPersisted,
      state,
      attentionState
    ]
  )

  return (
    <SessionAttentionContext.Provider value={reportAttentionState}>
      <AssistantSessionsContext.Provider value={value}>
        {children}
      </AssistantSessionsContext.Provider>
    </SessionAttentionContext.Provider>
  )
}
