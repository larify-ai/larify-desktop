import { Region } from '../layout/region'
import { AssistantPanel } from './assistant/components/assistant-panel'

export function Interaction(): React.JSX.Element {
  return (
    <Region label="Interaction" className="h-full min-w-0 overflow-hidden">
      <AssistantPanel />
    </Region>
  )
}
