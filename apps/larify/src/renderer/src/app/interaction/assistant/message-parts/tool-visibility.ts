import type { ToolPart } from '@renderer/components/ai-elements/tool'

export function isVisibleToolPart(part: ToolPart): boolean {
  return part.state !== 'input-streaming' && (!('rawInput' in part) || part.rawInput === undefined)
}
