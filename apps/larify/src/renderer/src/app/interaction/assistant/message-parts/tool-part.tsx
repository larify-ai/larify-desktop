import { getToolName } from 'ai'
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart as Part
} from '@renderer/components/ai-elements/tool'

function toolInput(input: unknown): { title?: string; args: unknown } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { args: input }
  }
  const { _title, ...args } = input as Record<string, unknown>
  return { title: typeof _title === 'string' ? _title : undefined, args }
}

export function ToolPart({ part }: { part: Part }): React.JSX.Element {
  const name = getToolName(part)
  const { title, args } = toolInput(part.input)
  const icon = (part.toolMetadata as { icon?: unknown } | undefined)?.icon

  return (
    <Tool>
      <ToolHeader
        type="dynamic-tool"
        toolName={name}
        title={title ?? name}
        icon={typeof icon === 'string' ? icon : undefined}
        state={part.state}
      />
      <ToolContent>
        <ToolInput input={{ name, args }} />
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  )
}
