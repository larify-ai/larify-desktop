import { memo, useCallback } from 'react'
import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'
import { useAssistantSessions } from './assistant/sessions-context'
import type { ConversationHeading } from './assistant/conversation-header'

const SessionView = memo(function SessionView({
  id,
  active,
  refresh,
  setHeading
}: {
  id: string
  active: boolean
  refresh: () => Promise<void>
  setHeading: (id: string, heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const updateHeading = useCallback(
    (heading: ConversationHeading | null) => setHeading(id, heading),
    [id, setHeading]
  )

  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <AssistantSession id={id} onHeadingChange={updateHeading} onSaved={refresh} />
    </div>
  )
})

export function Interaction(): React.JSX.Element {
  const { sessions, activeId, refresh, setHeading } = useAssistantSessions()

  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      {sessions.map((session) => (
        <SessionView
          key={session.id}
          id={session.id}
          active={session.id === activeId}
          refresh={refresh}
          setHeading={setHeading}
        />
      ))}
    </Region>
  )
}
