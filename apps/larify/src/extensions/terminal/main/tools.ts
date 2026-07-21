import { z } from 'zod'
import {
  normalizeTerminalInputLineBreaks,
  trimTrailingLineBreak
} from '../../../main/utils/text'
import { defineTool, type Toolkit } from '../../../shared/tool'
import type { TerminalService } from './terminal-service'
import type { TerminalAgentSnapshot } from '../shared/types'

function waitForIdle(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  idleSeconds: number,
  timeoutSeconds: number
): Promise<boolean> {
  if (timeoutSeconds <= 0 && idleSeconds <= 0) return Promise.resolve(false)
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
      resolve(false)
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
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (completed: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timeoutTimer)
      unbindFinished()
      unbindExit()
      resolve(completed)
    }

    const unbindFinished = service.bindCommandFinished((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      finish(true)
    })

    const unbindExit = service.bindExit((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      finish(true)
    })
    const timeoutTimer = setTimeout(() => finish(false), Math.max(0, timeoutSeconds * 1000))
  })
}

const terminalIdSchema = z
  .number()
  .int()
  .positive()
  .describe('Terminal id')

const createSchema = z.object({
  cwd: z.string().optional().describe('Working directory')
}).strict()

const closeSchema = z.object({
  id: terminalIdSchema
}).strict()

const writeSchema = z.object({
  id: terminalIdSchema,
  input: z
    .string()
    .describe('Raw input passed to node-pty write(). Use JSON unicode escapes for control characters.'),
  submit: z
    .boolean()
    .default(false)
    .describe('Append \\r if input has no newline'),
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
}).strict()

const readSchema = z.object({
  id: terminalIdSchema,
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
}).strict()

const terminalResult = (
  snapshot: TerminalAgentSnapshot,
  commandFinishEventReceived: boolean,
  log?: { path?: string }
): { status: string; snapshot: TerminalAgentSnapshot; log_path?: string } => {
  const status = commandFinishEventReceived
    ? 'shell integration command finish event received'
    : 'command may still be running or waiting for input'
  if (!log?.path) return { status, snapshot }
  return {
    status,
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
    description: 'Create terminals, run commands, operate interactive TUIs, and read terminal snapshots',
    tools: {
      list: defineTool({
        description: 'List all terminals',
        metadata: { icon: 'terminal' },
        inputSchema: z.object({}).strict(),
        execute: async (_args, ctx) => service.state(ctx.sessionId).terminals
      }),
      create: defineTool({
        description: 'Create a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: createSchema,
        execute: async (args, ctx) => {
          const terminalId = service.create(ctx.sessionId, args)
          return service.terminalState(ctx.sessionId, terminalId)
        }
      }),
      close: defineTool({
        description: 'Close a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: closeSchema,
        execute: async (args, ctx) => {
          const { id } = args
          if (!service.terminalState(ctx.sessionId, id)) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          await service.close(ctx.sessionId, id)
          return `Closed terminal ${id}.`
        }
      }),
      write: defineTool({
        description: 'Write raw node-pty input to a terminal',
        metadata: { icon: 'terminal' },
        inputSchema: writeSchema,
        execute: async (args, ctx) => {
          const { id, input, submit, timeout, idle } = args
          return service.withWriterLock(ctx.sessionId, id, async () => {
            const state = service.terminalState(ctx.sessionId, id)
            if (!state) throw new Error(`Terminal "${id}" not found.`)
            const data = input
              ? normalizeTerminalInputLineBreaks(submit ? `${trimTrailingLineBreak(input)}\r` : input)
              : input
            const submittedInput = Boolean(data?.endsWith('\r'))
            const shouldWaitForCommand =
              (submittedInput || state.commandRunning) && state.shellIntegration
            const commandWait = shouldWaitForCommand
              ? waitForCommandFinished(service, ctx.sessionId, id, timeout)
              : null
            const log = await service.startRun(ctx.sessionId, id)
            if (!log) throw new Error(`Terminal "${id}" not found.`)
            if (data) service.write(ctx.sessionId, id, data)
            const waitPromise = commandWait ?? waitForIdle(service, ctx.sessionId, id, idle, timeout)
            const waitCompleted = await waitPromise
            const completed = shouldWaitForCommand ? waitCompleted : false
            await service.flushRunHistory(ctx.sessionId, id)
            const snapshot = await service.agentSnapshot(ctx.sessionId, id)
            if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
            return terminalResult(snapshot, Boolean(shouldWaitForCommand && completed), log)
          })
        }
      }),
      read: defineTool({
        description: 'Read a terminal snapshot, including interactive TUI screens',
        metadata: { icon: 'terminal' },
        inputSchema: readSchema,
        execute: async (args, ctx) => {
          const { id, timeout, idle } = args
          const state = service.terminalState(ctx.sessionId, id)
          if (!state) {
            throw new Error(`Terminal "${id}" not found.`)
          }
          const completed =
            state.shellIntegration && state.commandRunning && timeout > 0
              ? await waitForCommandFinished(service, ctx.sessionId, id, timeout)
              : true
          if (!(state.shellIntegration && state.commandRunning && timeout > 0)) {
            await waitForIdle(service, ctx.sessionId, id, idle, timeout)
          }
          const log = await service.flushRunHistory(ctx.sessionId, id)
          const snapshot = await service.agentSnapshot(ctx.sessionId, id)
          if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
          const latestState = service.terminalState(ctx.sessionId, id)
          return terminalResult(
            snapshot,
            Boolean(completed && !latestState?.commandRunning),
            log ?? undefined
          )
        }
      })
    }
  }
}
