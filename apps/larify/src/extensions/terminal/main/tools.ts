import { z } from 'zod'
import type { Toolkit } from '../../../shared/tool'
import type { TerminalService } from './terminal-service'

type WaitReason = 'idle' | 'timeout'

function waitForIdle(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  idleSeconds: number,
  timeoutSeconds: number
): Promise<WaitReason> {
  return new Promise((resolve) => {
    let settled = false
    let idleTimer: NodeJS.Timeout | null = null
    const idleMs = Math.max(0, idleSeconds * 1000)
    const timeoutMs = Math.max(0, timeoutSeconds * 1000)

    const finish = (reason: WaitReason) => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(timeoutTimer)
      unbind()
      resolve(reason)
    }

    const armIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish('idle'), idleMs)
    }

    const unbind = service.bindData((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      armIdleTimer()
    })
    const timeoutTimer = setTimeout(() => finish('timeout'), timeoutMs)
    armIdleTimer()
  })
}

const terminalIdSchema = z
  .number()
  .int()
  .positive()
  .describe('Terminal id')

const createSchema = z.object({
  cwd: z.string().optional().describe('Working directory')
})

export function createTerminalToolkit(service: TerminalService): Toolkit {
  return {
    name: 'terminal',
    description: 'Create terminals, send input, and read terminal screens',
    tools: [
      {
        name: 'terminal_list',
        description: 'List all terminals',
        metadata: { icon: 'execute' },
        inputSchema: z.object({}),
        execute: async (_args, ctx) => service.state(ctx.sessionId).terminals
      },
      {
        name: 'terminal_create',
        description: 'Create a terminal',
        metadata: { icon: 'execute' },
        inputSchema: createSchema,
        execute: async (args, ctx) => {
          const terminalId = service.create(ctx.sessionId, args as z.infer<typeof createSchema>)
          return service.terminalState(ctx.sessionId, terminalId)
        }
      },
      {
        name: 'terminal_close',
        description: 'Close a terminal',
        metadata: { icon: 'execute' },
        inputSchema: z.object({
          id: terminalIdSchema
        }),
        execute: async (args, ctx) => {
          const { id } = args as { id: number }
          if (!service.terminalState(ctx.sessionId, id)) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          await service.close(ctx.sessionId, id)
          return `Closed terminal ${id}.`
        }
      },
      {
        name: 'terminal_write',
        description: 'Write raw node-pty input to a terminal',
        metadata: { icon: 'execute' },
        inputSchema: z.object({
          id: terminalIdSchema,
          input: z.string().describe('Raw input passed to node-pty write()'),
          submit: z.boolean().default(true).describe('Append Enter if input has no newline'),
          timeout: z
            .number()
            .nonnegative()
            .default(30)
            .describe('Wait timeout in seconds'),
          idle: z
            .number()
            .nonnegative()
            .default(0.5)
            .describe('Idle seconds before reading')
        }),
        execute: async (args, ctx) => {
          const { id, input, submit, timeout, idle } = args as {
            id: number
            input: string
            submit: boolean
            timeout: number
            idle: number
          }
          const log = await service.startRun(ctx.sessionId, id)
          if (!log) throw new Error(`Terminal "${id}" not found.`)
          const data = submit && !input.endsWith('\r') && !input.endsWith('\n') ? `${input}\r` : input
          service.write(ctx.sessionId, id, data)
          const reason = await waitForIdle(service, ctx.sessionId, id, idle, timeout)
          await service.flushRunHistory(ctx.sessionId, id)
          const snapshot = await service.agentSnapshot(ctx.sessionId, id)
          if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
          return {
            run_id: log.runId,
            reason,
            snapshot,
            log_path: log.path
          }
        }
      },
      {
        name: 'terminal_read',
        description: 'Read a terminal snapshot',
        metadata: { icon: 'read' },
        inputSchema: z.object({
          id: terminalIdSchema
        }),
        execute: async (args, ctx) => {
          const { id } = args as { id: number }
          if (!service.terminalState(ctx.sessionId, id)) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          await service.flushRunHistory(ctx.sessionId, id)
          const snapshot = await service.agentSnapshot(ctx.sessionId, id)
          if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
          return snapshot
        }
      }
    ]
  }
}
