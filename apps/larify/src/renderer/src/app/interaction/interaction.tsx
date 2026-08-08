import { memo, useCallback, useEffect, useRef } from 'react'
import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'
import { useAssistantSessions } from './assistant/sessions-context'
import type { ConversationHeading } from './assistant/conversation-header'

const SessionView = memo(function SessionView({
  id,
  active,
  persisted,
  refresh,
  setPersisted,
  setHeading
}: {
  id: string
  active: boolean
  persisted: boolean
  refresh: () => Promise<void>
  setPersisted: (id: string) => void
  setHeading: (id: string, heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const persistedRef = useRef(persisted)
  useEffect(() => {
    persistedRef.current = persisted
  }, [persisted])
  const updateHeading = useCallback(
    (heading: ConversationHeading | null) => setHeading(id, heading),
    [id, setHeading]
  )
  const saved = useCallback(async () => {
    if (persistedRef.current) return
    await refresh()
    persistedRef.current = true
    setPersisted(id)
  }, [id, refresh, setPersisted])

  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <AssistantSession id={id} onHeadingChange={updateHeading} onSaved={saved} />
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
          id={session.id}
          active={session.id === activeId}
          persisted={session.persisted}
          refresh={refresh}
          setPersisted={setPersisted}
          setHeading={setHeading}
        />
      ))}
    </Region>
  )
}
