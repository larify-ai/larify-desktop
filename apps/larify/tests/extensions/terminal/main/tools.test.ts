import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createTerminalToolkit } from "../../../../src/extensions/terminal/main/tools"
import type { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"

const ctx = { context: { sessionId: "session-1", cwd: "D:\\Workspace" } }

function createService(): TerminalService {
  return {
    createReady: vi.fn(),
    terminalState: vi.fn(),
    startRun: vi.fn(),
    write: vi.fn(),
    flushRunHistory: vi.fn(),
    agentSnapshot: vi.fn(),
    close: vi.fn(),
    bindData: vi.fn(() => () => {}),
    bindCommandFinished: vi.fn(() => () => {}),
    bindCommandStarted: vi.fn(() => () => {}),
    bindExit: vi.fn(() => () => {}),
    withWriterLock: vi.fn((_sessionId, _terminalId, fn) => fn()),
  } as unknown as TerminalService
}

function tool(
  name: string,
  service: TerminalService,
): {
  inputSchema: z.ZodTypeAny
  execute: (
    input: unknown,
    options: { context: { sessionId: string; cwd: string } },
  ) => Promise<unknown>
} {
  const found = createTerminalToolkit(service).tools[name]
  if (!found) throw new Error(`Tool ${name} not found`)
  const inputSchema = found.inputSchema as unknown as z.ZodTypeAny
  const rawExecute = found.execute as unknown as (input: unknown, options: unknown) => Promise<unknown>
  return {
    inputSchema,
    execute: (input: unknown, options: { context: { sessionId: string; cwd: string } }) =>
      rawExecute(inputSchema.parse(input), { ...options, toolCallId: "test", messages: [] }),
  }
}

function parseToolInput(
  name: string,
  input: unknown,
  service = createService(),
): ReturnType<z.ZodTypeAny["safeParse"]> {
  return tool(name, service).inputSchema.safeParse(input)
}

describe("terminal schemas", () => {
  it("rejects unknown fields", () => {
    expect(parseToolInput("list", { shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("create", { cwd: "D:\\Workspace", shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("close", { id: 1, shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("write", { id: 1, input: "echo hi", shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("write", { id: 1, input: "\u001b[B", shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("read", { id: 1, shell: "cmd.exe" }).success).toBe(false)
  })
})

describe("create", () => {
  it("waits for an agent terminal to be ready", async () => {
    const service = createService()
    vi.mocked(service.createReady).mockResolvedValue(1)
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })

    await expect(tool("create", service).execute({}, ctx)).resolves.toMatchObject({ id: 1 })
    expect(service.createReady).toHaveBeenCalledWith(
      "session-1",
      { cwd: "D:\\Workspace" },
      undefined,
    )
  })

  it("prefers an explicitly supplied working directory", async () => {
    const service = createService()
    vi.mocked(service.createReady).mockResolvedValue(1)
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Other",
      shell: "powershell.exe",
      exitCode: null,
    })

    await tool("create", service).execute({ cwd: "D:\\Other" }, ctx)

    expect(service.createReady).toHaveBeenCalledWith(
      "session-1",
      { cwd: "D:\\Other" },
      undefined,
    )
  })

  it("reports when the shell exits during startup", async () => {
    const service = createService()
    vi.mocked(service.createReady).mockResolvedValue(1)
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("create", service).execute({}, ctx)).rejects.toThrow(
      'Terminal "1" exited during startup.',
    )
  })

  it("reports when the created terminal is already exited", async () => {
    const service = createService()
    vi.mocked(service.createReady).mockResolvedValue(1)
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: false,
      exitCode: 1,
    })

    await expect(tool("create", service).execute({}, ctx)).rejects.toThrow(
      'Terminal "1" exited during startup.',
    )
  })
})

describe("close", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("close", service).execute({ id: 1 }, ctx)).rejects.toThrow(
      'Terminal "1" not found.',
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.close).not.toHaveBeenCalled()
  })

  it("syncs and closes an existing terminal", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })

    await expect(tool("close", service).execute({ id: 1 }, ctx)).resolves.toBe(
      "Closed terminal 1.",
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.close).toHaveBeenCalledWith("session-1", 1)
  })
})

describe("write", () => {
  it("returns the full terminal snapshot with run metadata", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({
      screen: "done",
    })

    await expect(
      tool("write", service).execute({ id: 1, input: "echo done", submit: true, timeout: 1, idle: 0 }, ctx),
    ).resolves.toEqual({
      status: "command may still be running or waiting for input",
      snapshot: {
        screen: "done",
      },
    })
    expect(service.withWriterLock).toHaveBeenCalledWith("session-1", 1, expect.any(Function))
    expect(service.write).toHaveBeenCalledWith("session-1", 1, "echo done\r")
  })

  it("returns log_path only after history is written", async () => {
    const service = createService()
    const log = { runId: "run-1", sessionId: "session-1", path: undefined as string | undefined }
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue(log)
    vi.mocked(service.flushRunHistory).mockImplementation(async () => {
      log.path = "run-1.log"
      return log
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write", service).execute({ id: 1, input: "echo done", submit: true, timeout: 1, idle: 0 }, ctx),
    ).resolves.toMatchObject({
      status: "command may still be running or waiting for input",
      snapshot: {
        screen: "(Earlier output in log_path)\ndone",
      },
      log_path: "run-1.log",
    })
  })

  it("runs terminal writes inside the terminal queue", async () => {
    const service = createService()
    const order: string[] = []
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.withWriterLock).mockImplementation(async (_sessionId, _terminalId, fn) => {
      order.push("lock")
      const result = await fn()
      order.push("unlock")
      return result
    })
    vi.mocked(service.startRun).mockImplementation(async () => {
      order.push("start")
      return { runId: "run-1", sessionId: "session-1" }
    })
    vi.mocked(service.write).mockImplementation(() => {
      order.push("write")
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({
      screen: "done",
    })

    await expect(
      tool("write", service).execute({ id: 1, input: "echo done", submit: true, timeout: 1, idle: 0 }, ctx),
    ).resolves.toMatchObject({ status: "command may still be running or waiting for input", snapshot: { screen: "done" } })

    expect(order).toEqual(["lock", "start", "write", "unlock"])
  })

  it("normalizes trailing newlines to carriage return when submitting", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await tool("write", service).execute(
      { id: 1, input: "idf.py menuconfig\r\n\n", submit: true, timeout: 1, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "idf.py menuconfig\r")
  })

  it("normalizes line breaks for raw terminal input", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await tool("write", service).execute(
      { id: 1, input: "first\nsecond\n\rthird\r\n", timeout: 1, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "first\rsecond\rthird\r")
  })

  it("does not append enter for raw TUI input", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await tool("write", service).execute(
      { id: 1, input: "\u001b[B", timeout: 1, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "\u001b[B")
  })

  it("uses idle wait for raw TUI input even with shell integration", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "menu" })

    await tool("write", service).execute(
      { id: 1, input: "\u001b[B", timeout: 1, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "\u001b[B")
    expect(service.bindCommandFinished).not.toHaveBeenCalled()
  })

  it("only waits for shell command completion when input ends with enter", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await tool("write", service).execute(
      { id: 1, input: "first\nsecond", timeout: 1, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "first\rsecond")
    expect(service.bindCommandFinished).not.toHaveBeenCalled()
  })

  it("waits without writing when input is empty", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write", service).execute({ id: 1, input: "", timeout: 1, idle: 0 }, ctx),
    ).resolves.toMatchObject({ status: "command may still be running or waiting for input", snapshot: { screen: "done" } })

    expect(service.write).not.toHaveBeenCalled()
    expect(service.bindCommandFinished).not.toHaveBeenCalled()
  })

  it("waits for shell integration completion when available", async () => {
    const service = createService()
    let commandFinished: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    let commandStarted: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.bindCommandStarted).mockImplementation((callback) => {
      commandStarted = callback
      return () => {}
    })
    vi.mocked(service.write).mockImplementation(() => {
      commandStarted?.("session-1", 1)
      commandFinished?.("session-1", 1, {})
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write", service).execute({ id: 1, input: "echo done", submit: true, timeout: 30 }, ctx),
    ).resolves.toMatchObject({ status: "shell integration command finish event received", snapshot: { screen: "done" } })

    expect(service.bindCommandFinished).toHaveBeenCalled()
  })

  it("returns after the idle window when a submitted command starts but stays silent", async () => {
    vi.useFakeTimers()
    const service = createService()
    let commandStarted: ((sessionId: string, terminalId: number) => void) | undefined
    let dataEvent: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandStarted).mockImplementation((callback) => {
      commandStarted = callback
      return () => {}
    })
    vi.mocked(service.bindData).mockImplementation((callback) => {
      dataEvent = callback as never
      return () => {}
    })
    vi.mocked(service.write).mockImplementation(() => {
      commandStarted?.("session-1", 1)
      dataEvent?.("session-1", 1)
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "Name:" })

    const pending = tool("write", service).execute(
      { id: 1, input: "Read-Host Name", submit: true, timeout: 300, idle: 2 },
      ctx,
    )
    await vi.advanceTimersByTimeAsync(2000)
    await expect(pending).resolves.toMatchObject({
      status: "command may still be running or waiting for input",
    })
    vi.useRealTimers()
  })

  it("honors the finish when answering an already-running command with no new start", async () => {
    const service = createService()
    let commandFinished: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      commandRunning: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.write).mockImplementation(() => {
      commandFinished?.("session-1", 1)
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "Hi Larify" })

    await expect(
      tool("write", service).execute({ id: 1, input: "Larify", submit: true, timeout: 30, idle: 5 }, ctx),
    ).resolves.toMatchObject({
      status: "shell integration command finish event received",
      snapshot: { screen: "Hi Larify" },
    })
  })

  it("does not miss a command-finished event that fires during startRun (bound before startRun)", async () => {
    const service = createService()
    let commandFinished: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      commandRunning: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.startRun).mockImplementation(async () => {
      commandFinished?.("session-1", 1, {})
      return { runId: "run-1", sessionId: "session-1" }
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write", service).execute({ id: 1, input: "", timeout: 300 }, ctx),
    ).resolves.toMatchObject({ status: "shell integration command finish event received" })
  })

  it("unbinds command listeners when starting the run fails", async () => {
    const service = createService()
    const unbindFinished = vi.fn()
    const unbindStarted = vi.fn()
    const unbindData = vi.fn()
    const unbindExit = vi.fn()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockReturnValue(unbindFinished)
    vi.mocked(service.bindCommandStarted).mockReturnValue(unbindStarted)
    vi.mocked(service.bindData).mockReturnValue(unbindData)
    vi.mocked(service.bindExit).mockReturnValue(unbindExit)
    vi.mocked(service.startRun).mockResolvedValue(null)

    await expect(
      tool("write", service).execute(
        { id: 1, input: "echo done", submit: true, timeout: 300 },
        ctx,
      ),
    ).rejects.toThrow('Terminal "1" not found.')

    expect(unbindFinished).toHaveBeenCalledOnce()
    expect(unbindStarted).toHaveBeenCalledOnce()
    expect(unbindData).toHaveBeenCalledOnce()
    expect(unbindExit).toHaveBeenCalledOnce()
  })

  it("reports when a running command ends by terminal exit without shell-integration 'D'", async () => {
    const service = createService()
    let exit: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.bindExit).mockImplementation((callback) => {
      exit = callback
      return () => {}
    })
    vi.mocked(service.write).mockImplementation(() => {
      exit?.("session-1", 1)
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write", service).execute({ id: 1, input: "exit", submit: true, timeout: 300 }, ctx),
    ).resolves.toMatchObject({
      status: "terminal exited before a shell integration command finish event",
      snapshot: { screen: "done" },
    })
    expect(service.bindExit).toHaveBeenCalled()
  })

  it("reports command may still be running and unbinds listeners when the wait times out", async () => {
    vi.useFakeTimers()
    const service = createService()
    const unbindFinished = vi.fn()
    const unbindExit = vi.fn()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockReturnValue(unbindFinished)
    vi.mocked(service.bindExit).mockReturnValue(unbindExit)
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.write).mockImplementation(() => {})
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    const pending = tool("write", service).execute(
      { id: 1, input: "sleep 5", submit: true, timeout: 1 },
      ctx,
    )
    await vi.advanceTimersByTimeAsync(1000)
    await expect(pending).resolves.toMatchObject({
      status: "command may still be running or waiting for input",
    })

    expect(unbindFinished).toHaveBeenCalled()
    expect(unbindExit).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it("rejects a timeout outside the 1-3600 second range", () => {
    expect(parseToolInput("write", { id: 1, input: "x", timeout: 0 }).success).toBe(false)
    expect(parseToolInput("write", { id: 1, input: "x", timeout: 3601 }).success).toBe(false)
    expect(parseToolInput("write", { id: 1, input: "x", timeout: 1 }).success).toBe(true)
    expect(parseToolInput("read", { id: 1, timeout: 0 }).success).toBe(false)
    expect(parseToolInput("read", { id: 1, timeout: 3600 }).success).toBe(true)
  })

})

describe("read", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("read", service).execute({ id: 1 }, ctx)).rejects.toThrow(
      'Terminal "1" not found.',
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.agentSnapshot).not.toHaveBeenCalled()
  })

  it("waits before reading when wait options are provided", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })
    vi.mocked(service.write).mockImplementation(() => {})
    vi.mocked(service.bindData).mockImplementation((callback) => {
      callback("session-1", 1, "done", 0, 4)
      return () => {}
    })

    await expect(tool("read", service).execute({ id: 1, timeout: 1, idle: 0 }, ctx)).resolves.toEqual({
      status: "command may still be running or waiting for input",
      snapshot: {
        screen: "done",
      },
    })

    expect(service.flushRunHistory).toHaveBeenCalledWith("session-1", 1)
    expect(service.agentSnapshot).toHaveBeenCalledWith("session-1", 1)
  })

  it("stops idle waiting when the terminal exits", async () => {
    const service = createService()
    let exit: ((sessionId: string, terminalId: number) => void) | undefined
    const unbindExit = vi.fn()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.bindExit).mockImplementation((callback) => {
      exit = callback
      return unbindExit
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    const reading = tool("read", service).execute({ id: 1, timeout: 300, idle: 30 }, ctx)
    await vi.waitFor(() => expect(exit).toBeTypeOf("function"))
    exit?.("session-1", 1)

    await expect(reading).resolves.toMatchObject({ snapshot: { screen: "done" } })
    expect(unbindExit).toHaveBeenCalledOnce()
  })

  it("returns log_path when terminal history was written", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      exitCode: null,
    })
    vi.mocked(service.flushRunHistory).mockResolvedValue({
      runId: "run-1",
      sessionId: "session-1",
      path: "run-1.log",
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(tool("read", service).execute({ id: 1, timeout: 1, idle: 0 }, ctx)).resolves.toEqual({
      status: "command may still be running or waiting for input",
      snapshot: {
        screen: "(Earlier output in log_path)\ndone",
      },
      log_path: "run-1.log",
    })
  })

  it("waits for a running shell integration command before reading", async () => {
    const service = createService()
    let commandFinished: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValueOnce({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      commandRunning: true,
      exitCode: null,
    }).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.flushRunHistory).mockImplementation(async () => {
      commandFinished?.("session-1", 1, {})
      return null
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    const promise = tool("read", service).execute({ id: 1, timeout: 30, idle: 0 }, ctx)
    commandFinished?.("session-1", 1, {})

    await expect(promise).resolves.toEqual({
      status: "shell integration command finish event received",
      snapshot: { screen: "done" },
    })
    expect(service.bindCommandFinished).toHaveBeenCalled()
  })

  it("does not report an old finish event after another command has started", async () => {
    vi.useFakeTimers()
    const service = createService()
    let commandFinished: ((sessionId: string, terminalId: number) => void) | undefined
    vi.mocked(service.terminalState).mockReturnValue({
      id: 1,
      pid: 100,
      title: "powershell",
      cwd: "D:\\Workspace",
      shell: "powershell.exe",
      shellIntegration: true,
      commandRunning: true,
      exitCode: null,
    })
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "next command" })

    const reading = tool("read", service).execute({ id: 1, timeout: 30, idle: 0 }, ctx)
    commandFinished?.("session-1", 1, {})
    await vi.advanceTimersByTimeAsync(1000)

    await expect(reading).resolves.toMatchObject({
      status: "command may still be running or waiting for input",
    })
    vi.useRealTimers()
  })
})
