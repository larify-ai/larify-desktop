import { useCallback } from 'react'
import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'
import { useAssistantSessions } from './assistant/sessions-context'
import type { ConversationHeading } from './assistant/conversation-header'

function SessionView({
  id,
  active,
  setHeading
}: {
  id: string
  active: boolean
  setHeading: (id: string, heading: ConversationHeading | null) => void
}): React.JSX.Element {
  const updateHeading = useCallback(
    (heading: ConversationHeading | null) => setHeading(id, heading),
    [id, setHeading]
  )

  return (
    <div className={active ? 'h-full' : 'hidden'}>
      <AssistantSession id={id} onHeadingChange={updateHeading} />
    </div>
  )
}

export function Interaction(): React.JSX.Element {
  const { sessions, activeId, setHeading } = useAssistantSessions()

  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      {sessions.map((session) => (
        <SessionView
          key={session.id}
          id={session.id}
          active={session.id === activeId}
          setHeading={setHeading}
        />
      ))}
    </Region>
  )
}
