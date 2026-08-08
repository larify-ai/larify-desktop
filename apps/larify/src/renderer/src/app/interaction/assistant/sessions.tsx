import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { ConversationHeading } from './conversation-header'
import { AssistantSessionsContext, type AssistantSessionState } from './sessions-context'

function createSession(): AssistantSessionState {
  return { id: crypto.randomUUID(), heading: null }
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

  const create = useCallback(() => {
    setState((current) => {
      const draft = current.sessions.find(({ heading }) => heading === null)
      if (draft) return { ...current, activeId: draft.id }

      const session = createSession()
      return { sessions: [...current.sessions, session], activeId: session.id }
    })
  }, [])
  const select = useCallback((activeId: string) => {
    setState((current) => ({ ...current, activeId }))
  }, [])
  const setHeading = useCallback((id: string, heading: ConversationHeading | null) => {
    setState((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, heading } : session
      )
    }))
  }, [])
  const activeSession = state.sessions.find(({ id }) => id === state.activeId)!
  const value = useMemo(
    () => ({ ...state, activeSession, create, select, setHeading }),
    [activeSession, create, select, setHeading, state]
  )

  return (
    <AssistantSessionsContext.Provider value={value}>{children}</AssistantSessionsContext.Provider>
  )
}
