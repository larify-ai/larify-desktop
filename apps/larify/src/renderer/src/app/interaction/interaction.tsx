import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'
import type { ConversationHeading } from './assistant/conversation-header'

export function Interaction({
  sessionKey,
  onHeadingChange
}: {
  sessionKey: number
  onHeadingChange: (heading: ConversationHeading | null) => void
}): React.JSX.Element {
  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      <AssistantSession key={sessionKey} onHeadingChange={onHeadingChange} />
    </Region>
  )
}
