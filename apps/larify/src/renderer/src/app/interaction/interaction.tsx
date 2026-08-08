import { memo, useCallback, useRef } from 'react'
import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'
import { useAssistantSessions, type AssistantSessionState } from './assistant/sessions-context'
import type { ConversationHeading } from './assistant/conversation-header'

const SessionView = memo(function SessionView({
  session,
  active,
  refresh,
  setPersisted,
  setHeading
}: {
  session: AssistantSessionState
  active: boolean
  refresh: () => Promise<void>
  setPersisted: (id: string) => void
  setHeading: (id: string, heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const { id, persisted, heading, messages, hasMore } = session
  const persistedRef = useRef(persisted)
  const refreshedRef = useRef(persisted)
  const updateHeading = useCallback(
    (heading: ConversationHeading | null) => setHeading(id, heading),
    [id, setHeading]
  )
  const saved = useCallback(async () => {
    if (refreshedRef.current) return
    refreshedRef.current = true
    if (!persistedRef.current) {
      persistedRef.current = true
      setPersisted(id)
    }
    try {
      await refresh()
    } catch (error) {
      refreshedRef.current = false
      throw error
    }
  }, [id, refresh, setPersisted])

  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <AssistantSession
        id={id}
        title={heading?.title}
        initialMessages={messages}
        initialHasMore={hasMore}
        initialCwd={heading?.cwd ?? ''}
        onHeadingChange={updateHeading}
        onSaved={saved}
      />
    </div>
  )
})

export function Interaction(): React.JSX.Element {
  const { sessions, activeId, refresh, setPersisted, setHeading } = useAssistantSessions()

  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      {sessions.map((session) => (
        <SessionView
          key={session.id}
          session={session}
          active={session.id === activeId}
          refresh={refresh}
          setPersisted={setPersisted}
          setHeading={setHeading}
        />
      ))}
    </Region>
  )
}
