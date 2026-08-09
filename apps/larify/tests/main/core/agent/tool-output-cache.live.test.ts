import { generateText, type ToolSet, type UIMessage } from 'ai'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { toModelMessages } from '../../../../src/main/core/agent/messages'
import { createModelRuntime } from '../../../../src/main/core/model'

const live = process.env.LIVE === '1' ? describe : describe.skip

live('historical tool output cache experiment', () => {
  it('keeps historical output stable when current diagnostics change', async () => {
    let currentDiagnostics = 'first current diagnostic'
    const tools = {
      fs_write: {
        description: 'Write a file.',
        inputSchema: z.object({ path: z.string() }),
        toModelOutput: ({ output }) => ({
          type: 'text' as const,
          value:
            (output as { summary: string; diagnostics?: string }).summary +
            ((output as { diagnostics?: string }).diagnostics ?? currentDiagnostics)
        })
      }
    } satisfies ToolSet
    const history = [
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-fs_write',
            toolCallId: 'call-1',
            state: 'output-available',
            input: { path: 'sample.ts' },
            output: {
              summary: 'File updated.',
              diagnostics: '\n- Line 1: stored diagnostic',
              patch: 'large patch excluded by toModelOutput'
            }
          }
        ]
      },
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Reply with only OK.' }]
      }
    ] as UIMessage[]
    const runtime = createModelRuntime()

    const firstMessages = await toModelMessages(history, tools)
    const first = await generateText({ ...runtime, tools, messages: firstMessages })

    currentDiagnostics = 'second current diagnostic'
    const secondMessages = await toModelMessages(history, tools)
    const second = await generateText({ ...runtime, tools, messages: secondMessages })

    expect(secondMessages).toEqual(firstMessages)
    expect(JSON.stringify(secondMessages)).toContain('stored diagnostic')
    expect(JSON.stringify(secondMessages)).not.toContain(currentDiagnostics)
    console.info(
      JSON.stringify({
        first: { usage: first.usage, providerMetadata: first.providerMetadata },
        second: { usage: second.usage, providerMetadata: second.providerMetadata }
      })
    )
  }, 60_000)
})
