import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool, toolContextSchema } from '../../../../src/main/core/plugin/protocol'

describe('tool protocol', () => {
  it('keeps modelId optional for tools that do not depend on model capabilities', () => {
    expect(
      toolContextSchema.parse({
        sessionId: 'session',
        cwd: 'cwd'
      })
    ).toEqual({
      sessionId: 'session',
      cwd: 'cwd'
    })
  })

  it('forwards asynchronous model output', async () => {
    const tool = defineTool({
      description: 'Async output',
      inputSchema: z.object({}),
      execute: () => 'image',
      toModelOutput: async (output) => ({
        type: 'text',
        value: `resolved:${output}`
      })
    })

    await expect(
      tool.toModelOutput?.({
        toolCallId: 'call',
        input: {},
        output: 'image'
      })
    ).resolves.toEqual({
      type: 'text',
      value: 'resolved:image'
    })
  })
})
