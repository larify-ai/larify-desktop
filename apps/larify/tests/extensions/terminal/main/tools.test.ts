import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { createTerminalToolkit } from "../../../../src/extensions/terminal/main/tools"
import type { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"
import type { Toolkit } from "../../../../src/shared/tool"

const ctx = { sessionId: "session-1" }
type TerminalTool = Toolkit["tools"][number]

function createService(): TerminalService {
  return {
    terminalState: vi.fn(),
    startRun: vi.fn(),
    write: vi.fn(),
    flushRunHistory: vi.fn(),
    agentSnapshot: vi.fn(),
    close: vi.fn(),
    bindData: vi.fn(() => () => {}),
    bindCommandFinished: vi.fn(() => () => {}),
    withWriterLock: vi.fn((_sessionId, _terminalId, fn) => fn()),
  } as unknown as TerminalService
}

function tool(name: string, service: TerminalService): TerminalTool {
  const found = createTerminalToolkit(service).tools.find((item) => item.name === name)
  if (!found) throw new Error(`Tool ${name} not found`)
  return found
}

function parseToolInput(name: string, input: unknown, service = createService()) {
  return (tool(name, service).inputSchema as z.ZodTypeAny).safeParse(input)
}

describe("terminal schemas", () => {
  it("rejects unknown fields", () => {
    expect(parseToolInput("list_terminals", { shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("create_terminal", { cwd: "D:\\Workspace", shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("close_terminal", { id: 1, shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("write_terminal", { id: 1, input: "echo hi", shell: "cmd.exe" }).success).toBe(false)
    expect(parseToolInput("read_terminal", { id: 1, shell: "cmd.exe" }).success).toBe(false)
  })
})

describe("close_terminal", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("close_terminal", service).execute({ id: 1 }, ctx)).rejects.toThrow(
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

    await expect(tool("close_terminal", service).execute({ id: 1 }, ctx)).resolves.toBe(
      "Closed terminal 1.",
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.close).toHaveBeenCalledWith("session-1", 1)
  })
})

describe("write_terminal", () => {
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
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
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
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
    ).resolves.toMatchObject({
      status: "command may still be running or waiting for input",
      snapshot: {
        screen: "(Earlier output omitted; full output in log_path.)\ndone",
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
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
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

    await tool("write_terminal", service).execute(
      { id: 1, input: "idf.py menuconfig\r\n\n", submit: true, timeout: 0, idle: 0 },
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

    await tool("write_terminal", service).execute(
      { id: 1, input: "first\nsecond\n\rthird\r\n", submit: false, timeout: 0, idle: 0 },
      ctx,
    )

    expect(service.write).toHaveBeenCalledWith("session-1", 1, "first\rsecond\rthird\r")
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
      tool("write_terminal", service).execute({ id: 1, input: "", submit: true, timeout: 0, idle: 0 }, ctx),
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
    vi.mocked(service.bindCommandFinished).mockImplementation((callback) => {
      commandFinished = callback
      return () => {}
    })
    vi.mocked(service.write).mockImplementation(() => {
      commandFinished?.("session-1", 1)
    })
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", sessionId: "session-1" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 30, idle: 0 }, ctx),
    ).resolves.toMatchObject({ status: "shell integration command finish event received", snapshot: { screen: "done" } })

    expect(service.bindCommandFinished).toHaveBeenCalled()
  })

})

describe("read_terminal", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("read_terminal", service).execute({ id: 1 }, ctx)).rejects.toThrow(
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

    await expect(tool("read_terminal", service).execute({ id: 1, timeout: 1, idle: 0 }, ctx)).resolves.toEqual({
      status: "shell integration command finish event received",
      snapshot: {
        screen: "done",
      },
    })

    expect(service.flushRunHistory).toHaveBeenCalledWith("session-1", 1)
    expect(service.agentSnapshot).toHaveBeenCalledWith("session-1", 1)
  })

  it("uses idle wait for shell integration terminals when timeout is zero", async () => {
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
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })
    vi.mocked(service.bindData).mockImplementation((callback) => {
      callback("session-1", 1, "done", 0, 4)
      return () => {}
    })

    await expect(tool("read_terminal", service).execute({ id: 1, timeout: 0, idle: 0.001 }, ctx)).resolves.toEqual({
      status: "shell integration command finish event received",
      snapshot: {
        screen: "done",
      },
    })

    expect(service.bindData).toHaveBeenCalled()
    expect(service.bindCommandFinished).not.toHaveBeenCalled()
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

    await expect(tool("read_terminal", service).execute({ id: 1, timeout: 0, idle: 0 }, ctx)).resolves.toEqual({
      status: "shell integration command finish event received",
      snapshot: {
        screen: "(Earlier output omitted; full output in log_path.)\ndone",
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
      commandFinished?.("session-1", 1)
      return null
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    const promise = tool("read_terminal", service).execute({ id: 1, timeout: 30, idle: 0 }, ctx)
    commandFinished?.("session-1", 1)

    await expect(promise).resolves.toEqual({
      status: "shell integration command finish event received",
      snapshot: { screen: "done" },
    })
    expect(service.bindCommandFinished).toHaveBeenCalled()
  })
})
