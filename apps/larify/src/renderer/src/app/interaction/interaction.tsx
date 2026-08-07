import { Region } from '../layout/region'
import { AssistantSession } from './assistant/session'

export function Interaction(): React.JSX.Element {
  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      <AssistantSession />
    </Region>
  )
}
