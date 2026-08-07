import type { ReasoningUIPart } from 'ai'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger
} from '@renderer/components/ai-elements/reasoning'

export function ReasoningPart({
  part,
  streaming
}: {
  part: ReasoningUIPart
  streaming: boolean
}): React.JSX.Element | null {
  if (!part.text) return null

  const isStreaming = part.state === 'streaming' || (part.state === undefined && streaming)

  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{part.text}</ReasoningContent>
    </Reasoning>
  )
}
