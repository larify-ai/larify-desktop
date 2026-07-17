import { z } from 'zod'
import type { Toolkit } from '../../../shared/tool'
import type { TerminalService } from './terminal-service'

function waitForIdle(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  idleSeconds: number,
  timeoutSeconds: number
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let idleTimer: NodeJS.Timeout | null = null
    const idleMs = Math.max(0, idleSeconds * 1000)
    const timeoutMs = Math.max(0, timeoutSeconds * 1000)

    const finish = (): void => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      unbind()
      resolve()
    }

    const armIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(finish, idleMs)
    }

    const unbind = service.bindData((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      armIdleTimer()
    })
    const timeoutTimer = timeoutMs > 0 ? setTimeout(finish, timeoutMs) : null
    armIdleTimer()
  })
}

function waitForCommandFinished(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  timeoutSeconds: number
): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      unbind()
      resolve()
    }

    const unbind = service.bindCommandFinished((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      finish()
    })
    const timeoutTimer = setTimeout(finish, Math.max(0, timeoutSeconds * 1000))
  })
}

function waitForTerminal(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  shellIntegration: boolean | undefined,
  idleSeconds: number,
  timeoutSeconds: number
): Promise<void> {
  if (shellIntegration && timeoutSeconds > 0) {
    return waitForCommandFinished(service, sessionId, terminalId, timeoutSeconds)
  }
  return waitForIdle(service, sessionId, terminalId, idleSeconds, timeoutSeconds)
}

const terminalIdSchema = z
  .number()
  .int()
  .positive()
  .describe('Terminal id')

const createSchema = z.object({
  cwd: z.string().optional().describe('Working directory')
})

const closeSchema = z.object({
  id: terminalIdSchema
})

const writeSchema = z.object({
  id: terminalIdSchema,
  input: z
    .string()
    .describe('Raw input passed to node-pty write(). Use JSON unicode escapes for control characters.'),
  submit: z.boolean().default(true).describe('Append Enter if input has no newline'),
  timeout: z
    .number()
    .nonnegative()
    .default(300)
    .describe('Wait timeout in seconds, default 300'),
  idle: z
    .number()
    .nonnegative()
    .default(30)
    .describe('Idle seconds before reading, default 30')
})

const readSchema = z.object({
  id: terminalIdSchema,
  timeout: z
    .number()
    .nonnegative()
    .default(30)
    .describe('Wait timeout in seconds, default 30'),
  idle: z
    .number()
    .nonnegative()
    .default(1)
    .describe('Idle seconds before reading, default 1')
})

const terminalResult = (
  snapshot: { screen: string },
  log?: { path?: string }
): { snapshot: { screen: string }; log_path?: string } => {
  if (!log?.path) return { snapshot }
  return {
    snapshot: {
      ...snapshot,
      screen: `(Earlier output omitted; full output in log_path.)\n${snapshot.screen}`
    },
    log_path: log.path
  }
}

export function createTerminalToolkit(service: TerminalService): Toolkit {
  return {
    name: 'terminal',
    description: 'Create terminals, send input, and read terminal screens',
    tools: [
      {
        name: 'list_terminals',
        description: 'List all terminals',
        metadata: { icon: 'terminal' },
        inputSchema: z.object({}),
        execute: async (_args, ctx) => service.state(ctx.sessionId).terminals
      },
      {
        name: 'create_terminal',
        description: 'Create a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: createSchema,
        execute: async (args, ctx) => {
          const terminalId = service.create(ctx.sessionId, args as z.infer<typeof createSchema>)
          return service.terminalState(ctx.sessionId, terminalId)
        }
      },
      {
        name: 'close_terminal',
        description: 'Close a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: closeSchema,
        execute: async (args, ctx) => {
          const { id } = args as z.infer<typeof closeSchema>
          if (!service.terminalState(ctx.sessionId, id)) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          await service.close(ctx.sessionId, id)
          return `Closed terminal ${id}.`
        }
      },
      {
        name: 'write_terminal',
        description: 'Write raw node-pty input to a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: writeSchema,
        execute: async (args, ctx) => {
          const { id, input, submit, timeout, idle } = args as z.infer<typeof writeSchema>
          return service.withWriterLock(ctx.sessionId, id, async () => {
            const state = service.terminalState(ctx.sessionId, id)
            if (!state) throw new Error(`Terminal "${id}" not found.`)
            const log = await service.startRun(ctx.sessionId, id)
            if (!log) throw new Error(`Terminal "${id}" not found.`)
            const data =
              input && submit && !input.endsWith('\r') && !input.endsWith('\n')
                ? `${input}\r`
                : input
            const waitPromise = waitForTerminal(
              service,
              ctx.sessionId,
              id,
              Boolean(data) && state.shellIntegration,
              idle,
              timeout
            )
            if (data) service.write(ctx.sessionId, id, data)
            await waitPromise
            await service.flushRunHistory(ctx.sessionId, id)
            const snapshot = await service.agentSnapshot(ctx.sessionId, id)
            if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
            return terminalResult(snapshot, log)
          })
        }
      },
      {
        name: 'read_terminal',
        description: 'Read a terminal snapshot',
        metadata: { icon: 'terminal' },
        inputSchema: readSchema,
        execute: async (args, ctx) => {
          const { id, timeout, idle } = args as z.infer<typeof readSchema>
          const state = service.terminalState(ctx.sessionId, id)
          if (!state) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          await waitForIdle(service, ctx.sessionId, id, idle, timeout)
          const log = await service.flushRunHistory(ctx.sessionId, id)
          const snapshot = await service.agentSnapshot(ctx.sessionId, id)
          if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
          return terminalResult(snapshot, log ?? undefined)
        }
      }
    ]
  }
}
