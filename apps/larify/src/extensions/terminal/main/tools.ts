import { z } from 'zod'
import {
  normalizeTerminalInputLineBreaks,
  trimTrailingLineBreak
} from '../../../main/utils/text'
import { defineTool, type Tool } from '../../../main/core/plugin/protocol'
import type { TerminalService } from './terminal-service'
import type { TerminalAgentSnapshot } from '../shared/types'

function waitForIdle(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  idleSeconds: number,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<boolean> {
  if (timeoutSeconds <= 0 || signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    let idleTimer: NodeJS.Timeout | null = null
    let unbindData = (): void => {}
    let unbindExit = (): void => {}
    const idleMs = Math.max(0, idleSeconds * 1000)
    const timeoutMs = Math.max(0, timeoutSeconds * 1000)

    const finish = (): void => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      if (timeoutTimer) clearTimeout(timeoutTimer)
      signal?.removeEventListener('abort', finish)
      unbindData()
      unbindExit()
      resolve(false)
    }

    const armIdleTimer = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(finish, idleMs)
    }

    unbindData = service.bindData((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      armIdleTimer()
    })
    unbindExit = service.bindExit((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      finish()
    })
    const timeoutTimer = timeoutMs > 0 ? setTimeout(finish, timeoutMs) : null
    signal?.addEventListener('abort', finish, { once: true })
    armIdleTimer()
  })
}

const SETTLE_MS = 1000

function linkedAbortController(signal?: AbortSignal): {
  controller: AbortController
  dispose: () => void
} {
  const controller = new AbortController()
  const abort = (): void => controller.abort()
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  return {
    controller,
    dispose: () => {
      signal?.removeEventListener('abort', abort)
      controller.abort()
    }
  }
}

type CommandWaitOutcome = 'finished' | 'exited' | 'pending'

function waitForCommandFinished(
  service: TerminalService,
  sessionId: string,
  terminalId: number,
  timeoutSeconds: number,
  signal?: AbortSignal,
  idleSeconds = 0
): Promise<CommandWaitOutcome> {
  if (signal?.aborted) return Promise.resolve('pending')
  return new Promise((resolve) => {
    let settled = false
    let started = false
    let settleTimer: NodeJS.Timeout | null = null
    let idleTimer: NodeJS.Timeout | null = null
    const idleMs = Math.max(0, idleSeconds * 1000)
    const finish = (outcome: CommandWaitOutcome): void => {
      if (settled) return
      settled = true
      if (settleTimer) clearTimeout(settleTimer)
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(timeoutTimer)
      signal?.removeEventListener('abort', onAbort)
      unbindFinished()
      unbindExit()
      unbindStarted()
      unbindData()
      resolve(outcome)
    }

    const armSettle = (): void => {
      if (settleTimer) clearTimeout(settleTimer)
      settleTimer = setTimeout(() => finish('finished'), SETTLE_MS)
    }

    const armIdle = (): void => {
      if (!started || idleMs <= 0) return
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish('pending'), idleMs)
    }

    const unbindFinished = service.bindCommandFinished((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      if (idleTimer) {
        clearTimeout(idleTimer)
        idleTimer = null
      }
      armSettle()
    })

    const unbindStarted = service.bindCommandStarted((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      started = true
      if (settleTimer) {
        clearTimeout(settleTimer)
        settleTimer = null
      }
      armIdle()
    })

    const unbindData = service.bindData((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId || settleTimer) return
      armIdle()
    })

    const unbindExit = service.bindExit((eventSessionId, eventTerminalId) => {
      if (eventSessionId !== sessionId || eventTerminalId !== terminalId) return
      finish('exited')
    })
    const onAbort = (): void => finish('pending')
    signal?.addEventListener('abort', onAbort, { once: true })
    const timeoutTimer = setTimeout(
      () => finish('pending'),
      Math.max(0, timeoutSeconds * 1000)
    )
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
    .default(true)
    .describe('Append \\r to execute the input'),
  interrupt: z
    .boolean()
    .default(true)
    .describe('Send \\u0003 before writing the input'),
  timeout: z
    .number()
    .min(1)
    .max(3600)
    .default(300)
    .describe('Wait timeout in seconds, 1-3600, default 300'),
  idle: z
    .number()
    .nonnegative()
    .max(3600)
    .default(30)
    .describe('Idle seconds before reading, default 30')
}).strict()

const readSchema = z.object({
  id: terminalIdSchema,
  timeout: z
    .number()
    .min(1)
    .max(3600)
    .default(300)
    .describe('Wait timeout in seconds, 1-3600, default 300'),
  idle: z
    .number()
    .nonnegative()
    .max(3600)
    .default(30)
    .describe('Idle seconds before reading, default 30')
}).strict()

const terminalResult = (
  snapshot: TerminalAgentSnapshot,
  outcome: CommandWaitOutcome,
  log?: { path?: string }
): { status: string; snapshot: TerminalAgentSnapshot; log_path?: string } => {
  const status =
    outcome === 'finished'
      ? 'shell integration command finish event received'
      : outcome === 'exited'
        ? 'terminal exited before a shell integration command finish event'
        : 'command may still be running or waiting for input'
  if (!log?.path) return { status, snapshot }
  return {
    status,
    snapshot: {
      ...snapshot,
      screen: `(Earlier output in log_path)\n${snapshot.screen}`
    },
    log_path: log.path
  }
}

export function createTerminalToolkit(service: TerminalService): Record<string, Tool> {
  return {
      list: defineTool({
        description: 'List all terminals',
        metadata: { icon: 'terminal', eager: true },
        inputSchema: z.object({}).strict(),
        execute: async (_args, ctx) => service.state(ctx.sessionId).terminals
      }),
      create: defineTool({
        description: 'Create a terminal only when none is available',
        metadata: { icon: 'terminal', eager: true },
        inputSchema: createSchema,
        execute: async (args, ctx) => {
          const terminalId = await service.createReady(
            ctx.sessionId,
            { cwd: args.cwd ?? ctx.cwd },
            ctx.signal
          )
          const state = service.terminalState(ctx.sessionId, terminalId)
          if (!state || state.exitCode !== null) {
            throw new Error(`Terminal "${terminalId}" exited during startup.`)
          }
          return state
        }
      }),
      close: defineTool({
        description: 'Close a terminal',
        metadata: { icon: 'terminal', eager: true },
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
        description:
          "Write raw node-pty input to a terminal. Tip: This is a real TTY: interactive commands (e.g. `git diff`) won't emit a finish event and will block until idle/timeout — use non-interactive commands (e.g. `git --no-pager diff`) to improve efficiency.",
        metadata: { icon: 'terminal', eager: true },
        inputSchema: writeSchema,
        execute: async (args, ctx) => {
          const { id, input, submit, interrupt, timeout, idle } = args
          return service.withWriterLock(ctx.sessionId, id, async () => {
            const state = service.terminalState(ctx.sessionId, id)
            if (!state) throw new Error(`Terminal "${id}" not found.`)
            const data = submit
              ? normalizeTerminalInputLineBreaks(`${trimTrailingLineBreak(input)}\r`)
              : normalizeTerminalInputLineBreaks(input)
            const submittedInput = data.endsWith('\r')
            const shouldWaitForCommand =
              (submittedInput || (!data && state.commandRunning)) && Boolean(state.shellIntegration)
            const commandWaitAbort = shouldWaitForCommand
              ? linkedAbortController(ctx.signal)
              : null
            const commandWait = commandWaitAbort
              ? waitForCommandFinished(
                  service,
                  ctx.sessionId,
                  id,
                  timeout,
                  commandWaitAbort.controller.signal,
                  idle
                )
              : null
            try {
              const log = await service.startRun(ctx.sessionId, id)
              if (!log) throw new Error(`Terminal "${id}" not found.`)
              // interrupt: send a real Ctrl+C (ETX, 0x03) to stop the foreground
              // process before writing the new input, preventing interleaved writes
              // to an already-running command (agent flows default this on).
              // node-pty forwards the byte to the ConPTY, which triggers the interrupt.
              if (interrupt) service.write(ctx.sessionId, id, '\x03')
              if (data) service.write(ctx.sessionId, id, data)
              let outcome: CommandWaitOutcome = 'pending'
              if (commandWait) outcome = await commandWait
              else await waitForIdle(service, ctx.sessionId, id, idle, timeout, ctx.signal)
              await service.flushRunHistory(ctx.sessionId, id)
              const snapshot = await service.agentSnapshot(ctx.sessionId, id)
              if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
              return terminalResult(snapshot, outcome, log)
            } finally {
              commandWaitAbort?.dispose()
            }
          })
        }
      }),
      read: defineTool({
        description: 'Read a terminal snapshot, including interactive TUI screens',
        metadata: { icon: 'terminal', eager: true },
        inputSchema: readSchema,
        execute: async (args, ctx) => {
          const { id, timeout, idle } = args
          return service.withWriterLock(ctx.sessionId, id, async () => {
            const state = service.terminalState(ctx.sessionId, id)
            if (!state) throw new Error(`Terminal "${id}" not found.`)
            const waitForCommand = state.shellIntegration && state.commandRunning && timeout > 0
            const outcome = waitForCommand
              ? await waitForCommandFinished(service, ctx.sessionId, id, timeout, ctx.signal)
              : 'pending'
            if (!waitForCommand) {
              await waitForIdle(service, ctx.sessionId, id, idle, timeout, ctx.signal)
            }
            const log = await service.flushRunHistory(ctx.sessionId, id)
            const snapshot = await service.agentSnapshot(ctx.sessionId, id)
            if (!snapshot) throw new Error(`Terminal "${id}" not found.`)
            const latestState = service.terminalState(ctx.sessionId, id)
            return terminalResult(
              snapshot,
              outcome === 'finished' && latestState?.commandRunning ? 'pending' : outcome,
              log ?? undefined
            )
          })
        }
      })
    }
}
