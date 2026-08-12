import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DynamicToolUIPart } from 'ai'

const captured = vi.hoisted(() => ({
  tool: undefined as Record<string, unknown> | undefined,
  header: undefined as Record<string, unknown> | undefined,
  input: undefined as unknown,
  output: undefined as unknown,
  question: undefined as unknown,
  submitQuestion: undefined as ((answers: string[]) => void) | undefined,
  toolOutput: vi.fn()
}))

vi.mock('@renderer/components/ai-elements/tool', () => ({
  Tool: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => {
    captured.tool = props
    return children
  },
  ToolContent: ({ children }: React.PropsWithChildren) => children,
  ToolHeader: (props: Record<string, unknown>) => {
    captured.header = props
    return null
  },
  ToolInput: ({ input }: { input: unknown }) => {
    captured.input = input
    return null
  },
  ToolOutput: ({ output }: { output: unknown }) => {
    captured.output = output
    return null
  }
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/message-parts/ask-user-part', () => ({
  AskUserPart: ({ input, onSubmit }: { input: unknown; onSubmit: (answers: string[]) => void }) => {
    captured.question = input
    captured.submitQuestion = onSubmit
    return null
  }
}))

vi.mock('../../../src/renderer/src/app/interaction/assistant/tool-output', () => ({
  useToolOutput: () => captured.toolOutput
}))

import { ToolPart } from '../../../src/renderer/src/app/interaction/assistant/message-parts/tool-part'

beforeEach(() => {
  captured.tool = undefined
  captured.header = undefined
  captured.input = undefined
  captured.output = undefined
  captured.question = undefined
  captured.submitQuestion = undefined
  captured.toolOutput.mockReset()
})

describe('interaction assistant tool part', () => {
  it('separates display metadata from executable arguments', () => {
    render({
      input: { toolCallTitle: 'Read file', path: 'a.txt' },
      output: 'done',
      state: 'output-available',
      toolCallId: 'call-1',
      toolMetadata: { icon: 'read' },
      toolName: 'fs_read',
      type: 'dynamic-tool'
    })

    expect(captured.header).toMatchObject({
      icon: 'read',
      state: 'output-available',
      title: 'Read file',
      toolName: 'fs_read'
    })
    expect(captured.input).toEqual({ name: 'fs_read', args: { path: 'a.txt' } })
    expect(captured.output).toBe('done')
  })

  it('falls back to the tool name for legacy inputs', () => {
    render({
      input: { path: 'a.txt' },
      state: 'input-available',
      toolCallId: 'call-1',
      toolName: 'fs_read',
      type: 'dynamic-tool'
    })

    expect(captured.header?.title).toBe('fs_read')
  })

  it('uses raw input metadata when tool input validation fails', () => {
    render({
      errorText: 'Invalid input',
      rawInput: { toolCallTitle: '查询计数器数值', selector: '#count' },
      state: 'output-error',
      toolCallId: 'call-1',
      toolName: 'browser_query_element',
      type: 'dynamic-tool'
    })

    expect(captured.header?.title).toBe('查询计数器数值')
    expect(captured.input).toEqual({
      name: 'browser_query_element',
      args: { selector: '#count' }
    })
  })

  it('does not expose the internal tool name before the streamed title arrives', () => {
    render({
      input: { path: 'partially-streamed' },
      state: 'input-streaming',
      toolCallId: 'call-1',
      toolName: 'fs_read',
      type: 'dynamic-tool'
    })

    expect(captured.header).toBeUndefined()
  })

  it('does not show an incomplete ask-user form while its input is streaming', () => {
    render({
      input: {
        toolCallTitle: '等待用户回答',
        message: 'Choose',
        options: [{ label: 'Partially streamed' }]
      },
      state: 'input-streaming',
      toolCallId: 'call-1',
      toolName: 'agent_ask_user',
      type: 'dynamic-tool'
    })

    expect(captured.header).toMatchObject({ statusLabel: '等待回答' })
    expect(captured.tool?.defaultOpen).toBe(false)
    expect(captured.question).toBeUndefined()
  })

  it('shows ask-user content when the complete input is available', () => {
    const input = { message: 'Choose', options: [{ label: 'Ready' }] }
    render({
      input,
      state: 'input-available',
      toolCallId: 'call-1',
      toolName: 'agent_ask_user',
      type: 'dynamic-tool'
    })

    expect(captured.question).toBe(input)
    expect(captured.tool?.defaultOpen).toBe(true)
    expect(captured.header).toMatchObject({ statusLabel: '等待回答' })
    captured.submitQuestion?.(['Ready'])
    expect(captured.toolOutput).toHaveBeenCalledWith('agent_ask_user', 'call-1', {
      answers: ['Ready']
    })
  })
})

function render(
  part: DynamicToolUIPart | (Omit<DynamicToolUIPart, 'input'> & { rawInput: unknown })
): void {
  renderToStaticMarkup(createElement(ToolPart, { part }))
}
