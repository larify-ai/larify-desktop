import { getToolName } from 'ai'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart as Part
} from '@renderer/components/ai-elements/tool'
import { AskUserPart } from './ask-user-part'
import { useToolOutput } from '../tool-output'

function toolInput(input: unknown): { title?: string; args: unknown } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { args: input }
  }
  const { toolCallTitle, ...args } = input as Record<string, unknown>
  return { title: typeof toolCallTitle === 'string' ? toolCallTitle : undefined, args }
}

export function ToolPart({ part }: { part: Part }): React.JSX.Element {
  const name = getToolName(part)
  const onToolOutput = useToolOutput()
  const { title, args } = toolInput(part.input)
  const metadata = part.toolMetadata as { icon?: unknown } | undefined
  const icon = typeof metadata?.icon === 'string' ? metadata.icon : undefined

  if (name === 'agent_ask_user') {
    const asking = part.state === 'input-available'
    const waiting = part.state === 'input-streaming' || asking
    const showQuestion = part.state === 'input-available' || part.state === 'output-available'
    return (
      <Tool key={asking ? 'asking' : 'settled'} defaultOpen={asking}>
        <ToolHeader
          className="p-2.5"
          type="dynamic-tool"
          toolName={name}
          title={title ?? name}
          icon={icon}
          state={part.state}
          statusLabel={waiting ? '等待回答' : undefined}
        />
        <ToolContent className="space-y-3 p-3 pt-1">
          {showQuestion ? (
            <AskUserPart
              input={part.input}
              output={part.output}
              onSubmit={(answers) => onToolOutput?.(name, part.toolCallId, { answers })}
            />
          ) : (
            <ToolOutput output={part.output} errorText={part.errorText} />
          )}
        </ToolContent>
      </Tool>
    )
  }

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        toolName={name}
        title={title ?? name}
        icon={icon}
        state={part.state}
      />
      <ToolContent>
        <ToolInput input={{ name, args }} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}
