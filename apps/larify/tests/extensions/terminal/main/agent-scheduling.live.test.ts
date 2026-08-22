import { convertArrayToReadableStream, MockLanguageModelV4 } from 'ai/test'
import { isLoopFinished, type ToolSet, type UIMessage } from 'ai'
import type { LanguageModelV4FinishReason, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { describe, expect, it } from 'vitest'
import type { Tool } from '../../../../src/main/core/plugin/protocol'
import { runAgentSession } from '../../../../src/main/core/agent'
import { ResourceManager } from '../../../../src/main/core/resource'
import { createTerminalToolkit } from '../../../../src/extensions/terminal/main/tools'
import { TerminalService } from '../../../../src/extensions/terminal/main/terminal-service'

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}

const finishReason = (
  unified: LanguageModelV4FinishReason['unified']
): LanguageModelV4FinishReason => ({ unified, raw: undefined })

const toolCall = (name: string, input: object, index: number): LanguageModelV4StreamPart[] => [
  { type: 'stream-start' as const, warnings: [] },
  {
    type: 'tool-call' as const,
    toolCallId: `terminal-call-${index}`,
    toolName: `terminal_${name}`,
    input: JSON.stringify(input)
  },
  { type: 'finish' as const, finishReason: finishReason('tool-calls'), usage: USAGE }
]

const finalReply: LanguageModelV4StreamPart[] = [
  { type: 'stream-start' as const, warnings: [] },
  { type: 'text-start' as const, id: 'final' },
  { type: 'text-delta' as const, id: 'final', delta: 'Terminal workflow completed.' },
  { type: 'text-end' as const, id: 'final' },
  { type: 'finish' as const, finishReason: finishReason('stop'), usage: USAGE }
]

const commandFor = (title: string, marker: string): string => {
  if (title === 'PowerShell') return `Write-Output "${marker}"`
  if (title === 'CMD') return `echo ${marker}`
  return `printf '%s\\n' '${marker}'`
}

const executeTool = async <T>(
  tool: Tool,
  input: unknown,
  sessionId: string,
  cwd: string,
  signal?: AbortSignal
): Promise<T> => {
  const schema = tool.inputSchema as unknown as { parse(value: unknown): unknown }
  const execute = tool.execute as unknown as (input: unknown, options: unknown) => Promise<T>
  return execute(schema.parse(input), {
    abortSignal: signal,
    context: { cwd, sessionId },
    messages: [],
    toolCallId: 'agent-scheduling'
  })
}

describe.skipIf(!process.env.LIVE_TERMINAL)('Agent terminal scheduling', () => {
  it('runs every terminal tool through the agent loop and releases the resource', async () => {
    const resources = new ResourceManager()
    const service = new TerminalService(resources)
    const sessionId = `agent-terminal-${Date.now()}`
    const marker = `LARIFY_AGENT_SCHEDULING_${Date.now()}`
    const tools = Object.fromEntries(
      Object.entries(createTerminalToolkit(service)).map(([name, tool]) => [
        `terminal_${name}`,
        tool
      ])
    ) as ToolSet
    const resourceStates: number[][] = []
    const unbindResources = resources.bindChange((current) => {
      resourceStates.push(
        current.filter((resource) => resource.sessionId === sessionId).map(({ id }) => id)
      )
    })
    let step = 0
    const model = new MockLanguageModelV4({
      doStream: async () => {
        const terminal = service.state(sessionId).terminals[0]
        const chunks = (() => {
          switch (step++) {
            case 0:
              return toolCall('create', {}, step)
            case 1:
              return toolCall('list', {}, step)
            case 2:
              if (!terminal) throw new Error('Agent create step did not create a terminal.')
              return toolCall(
                'write',
                {
                  id: terminal.id,
                  input: commandFor(terminal.title, marker),
                  submit: true,
                  timeout: 10,
                  idle: 1
                },
                step
              )
            case 3:
              if (!terminal) throw new Error('Agent write step lost the terminal.')
              return toolCall('read', { id: terminal.id, timeout: 2, idle: 0 }, step)
            case 4:
              if (!terminal) throw new Error('Agent read step lost the terminal.')
              return toolCall('close', { id: terminal.id }, step)
            default:
              return finalReply
          }
        })()
        return { stream: convertArrayToReadableStream(chunks) }
      }
    })
    const chunks: string[] = []

    try {
      const messages = await runAgentSession(
        [
          {
            id: 'user',
            role: 'user',
            parts: [{ type: 'text', text: `Create a terminal and print ${marker}.` }]
          }
        ],
        {
          model,
          tools,
          activeTools: Object.keys(tools),
          toolsContext: Object.fromEntries(
            Object.keys(tools).map((name) => [name, { sessionId, cwd: process.cwd() }])
          ),
          stopWhen: isLoopFinished()
        },
        (chunk) => chunks.push(chunk.type)
      )

      const serialized = JSON.stringify(messages)
      expect(serialized).toContain(marker)
      expect(serialized).toContain('Terminal workflow completed.')
      expect(chunks.filter((type) => type === 'tool-input-available')).toHaveLength(5)
      expect(chunks.filter((type) => type === 'tool-output-available')).toHaveLength(5)
      expect(resourceStates.some((ids) => ids.length === 1)).toBe(true)
      expect(service.state(sessionId).terminals).toEqual([])
      expect(resources.list({ sessionId })).toEqual([])
      expect((messages.at(-1) as UIMessage).role).toBe('assistant')
    } finally {
      unbindResources()
      await service.destroy()
    }
  }, 30_000)

  it('keeps multiple Agent terminals isolated and cleans up large and failed runs', async () => {
    const resources = new ResourceManager()
    const service = new TerminalService(resources)
    const toolkit = createTerminalToolkit(service)
    const cwd = process.cwd()
    const firstSession = `agent-multi-a-${Date.now()}`
    const secondSession = `agent-multi-b-${Date.now()}`
    const marker = `LARIFY_AGENT_LARGE_${Date.now()}`

    try {
      const first = await executeTool<{ id: number; title: string }>(
        toolkit.create,
        {},
        firstSession,
        cwd
      )
      const failed = await executeTool<{ id: number; title: string }>(
        toolkit.create,
        {},
        firstSession,
        cwd
      )
      const isolated = await executeTool<{ id: number }>(toolkit.create, {}, secondSession, cwd)

      const largeCommand =
        first.title === 'PowerShell'
          ? `1..7000 | ForEach-Object { "line-$_" }; Write-Output "${marker}"`
          : first.title === 'CMD'
            ? `for /L %i in (1,1,7000) do @echo line-%i & echo ${marker}`
            : `for i in $(seq 1 7000); do echo line-$i; done; echo '${marker}'`
      const large = await executeTool<{
        log_path?: string
        snapshot: { screen: string }
      }>(
        toolkit.write,
        { id: first.id, idle: 1, input: largeCommand, submit: true, timeout: 30 },
        firstSession,
        cwd
      )
      expect(large.snapshot.screen).toContain(marker)
      expect(large.log_path).toBeTruthy()

      await expect(
        executeTool(toolkit.read, { id: first.id, idle: 0, timeout: 1 }, secondSession, cwd)
      ).rejects.toThrow(`Terminal "${first.id}" not found.`)

      await executeTool(
        toolkit.write,
        {
          id: failed.id,
          idle: 0,
          input:
            failed.title === 'PowerShell' || failed.title === 'CMD' ? 'cmd /c exit 7' : 'false',
          submit: true,
          timeout: 10
        },
        firstSession,
        cwd
      )
      expect(service.terminalState(firstSession, failed.id)?.exitCode).toBeNull()
      expect(resources.list({ sessionId: firstSession }).map(({ id }) => id)).toEqual([
        first.id,
        failed.id
      ])
      expect(resources.list({ sessionId: secondSession }).map(({ id }) => id)).toEqual([
        isolated.id
      ])

      await executeTool(toolkit.close, { id: first.id }, firstSession, cwd)
      await executeTool(toolkit.close, { id: failed.id }, firstSession, cwd)
      await executeTool(toolkit.close, { id: isolated.id }, secondSession, cwd)
      expect(resources.list()).toEqual([])
    } finally {
      await service.destroy()
    }
  }, 60_000)
})
