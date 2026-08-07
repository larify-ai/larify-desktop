import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DynamicToolUIPart } from 'ai'

const captured = vi.hoisted(() => ({
  header: undefined as Record<string, unknown> | undefined,
  input: undefined as unknown,
  output: undefined as unknown
}))

vi.mock('@renderer/components/ai-elements/tool', () => ({
  Tool: ({ children }: React.PropsWithChildren) => children,
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

import { ToolPart } from '../../../src/renderer/src/app/interaction/assistant/message-parts/tool-part'

beforeEach(() => {
  captured.header = undefined
  captured.input = undefined
  captured.output = undefined
})

describe('interaction assistant tool part', () => {
  it('separates display metadata from executable arguments', () => {
    render({
      input: { _title: 'Read file', path: 'a.txt' },
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
})

function render(part: DynamicToolUIPart): void {
  renderToStaticMarkup(createElement(ToolPart, { part }))
}
