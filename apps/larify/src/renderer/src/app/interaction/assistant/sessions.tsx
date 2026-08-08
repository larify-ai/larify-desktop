import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ConversationHeading } from './conversation-header'
import { AssistantSessionsContext, type AssistantSessionState } from './sessions-context'
import {
  loadSessionDirectory,
  loadSessionPage,
  type SessionDirectoryGroup
} from './session-directory'
import { loadMessagePage } from './session-messages'

function createSession(): AssistantSessionState {
  return { id: crypto.randomUUID(), heading: null, persisted: false, messages: [], hasMore: false }
}

interface SessionsState {
  sessions: AssistantSessionState[]
  activeId: string
}

function createState(): SessionsState {
  const session = createSession()
  return { sessions: [session], activeId: session.id }
}

export function AssistantSessionsProvider({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const [state, setState] = useState(createState)
  const [directory, setDirectory] = useState<SessionDirectoryGroup[]>([])
  const refreshVersion = useRef(0)
  const loading = useRef(new Set<string>())
  const selected = useRef(state.activeId)

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    const value = await loadSessionDirectory()
    if (version === refreshVersion.current) setDirectory(value)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const create = useCallback(() => {
    setState((current) => {
      const draft = current.sessions.find(({ persisted }) => !persisted)
      if (draft) {
        selected.current = draft.id
        return { ...current, activeId: draft.id }
      }

      const session = createSession()
      selected.current = session.id
      return { sessions: [...current.sessions, session], activeId: session.id }
    })
  }, [])
  const select = useCallback(
    async (activeId: string) => {
      if (state.sessions.some(({ id }) => id === activeId)) {
        selected.current = activeId
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
        return
      }
      setState((current) => {
        const existing = current.sessions.find(({ id }) => id === activeId)
        const sessions = existing
          ? current.sessions
          : [
              ...current.sessions,
              {
                id: activeId,
                heading: { cwd: stored.cwd, title: stored.title },
                persisted: true,
                ...page
              }
            ]
        return { sessions, activeId: selected.current === activeId ? activeId : current.activeId }
      })
    },
    [directory, state.sessions]
  )
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
        session.id === id ? { ...session, heading } : session
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
  const activeSession = state.sessions.find(({ id }) => id === state.activeId)!
  const value = useMemo(
    () => ({
      ...state,
      directory,
      activeSession,
      create,
      select,
      loadMore,
      refresh,
      setPersisted,
      setHeading
    }),
    [activeSession, create, directory, loadMore, refresh, select, setHeading, setPersisted, state]
  )

  return (
    <AssistantSessionsContext.Provider value={value}>{children}</AssistantSessionsContext.Provider>
  )
}
