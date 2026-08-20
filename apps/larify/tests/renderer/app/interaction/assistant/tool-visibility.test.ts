import { describe, expect, it } from 'vitest'
import type { ToolPart } from '../../../../../src/renderer/src/components/ai-elements/tool'
import { isVisibleToolPart } from '../../../../../src/renderer/src/app/interaction/assistant/message-parts/tool-visibility'

const toolPart = (value: Record<string, unknown>): ToolPart =>
  ({
    type: 'dynamic-tool',
    toolName: 'fs_read',
    toolCallId: 'call-1',
    ...value
  }) as ToolPart

describe('isVisibleToolPart', () => {
  it('hides every input-streaming part even when partial input already exists', () => {
    expect(
      isVisibleToolPart(toolPart({ state: 'input-streaming', input: { toolCallTitle: 'Partial' } }))
    ).toBe(false)
  })

  it.each([
    'input-available',
    'approval-requested',
    'approval-responded',
    'output-available',
    'output-error',
    'output-denied'
  ])('shows the %s state after input validation', (state) => {
    expect(isVisibleToolPart(toolPart({ state, input: {} }))).toBe(true)
  })

  it('hides a static tool part whose input failed validation', () => {
    expect(
      isVisibleToolPart(
        toolPart({
          type: 'tool-fs_read',
          state: 'output-error',
          input: undefined,
          rawInput: { path: 42 },
          errorText: 'Invalid input'
        })
      )
    ).toBe(false)
  })

  it('does not mistake an explicit undefined rawInput for invalid input', () => {
    expect(
      isVisibleToolPart(toolPart({ state: 'output-available', input: {}, rawInput: undefined }))
    ).toBe(true)
  })
})
