import { describe, expect, it, vi } from "vitest"
import { createTerminalToolkit } from "../../../../src/extensions/terminal/main/tools"
import type { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"

const ctx = { sessionId: "session-1" }

function createService() {
  return {
    terminalState: vi.fn(),
    startRun: vi.fn(),
    write: vi.fn(),
    flushRunHistory: vi.fn(),
    agentSnapshot: vi.fn(),
    close: vi.fn(),
    bindData: vi.fn(() => () => {}),
    withWriterLock: vi.fn((_sessionId, _terminalId, fn) => fn()),
  } as unknown as TerminalService
}

function tool(name: string, service: TerminalService) {
  const found = createTerminalToolkit(service).tools.find((item) => item.name === name)
  if (!found) throw new Error(`Tool ${name} not found`)
  return found
}

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
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", path: "run-1.log" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({
      screen: "done",
    })

    await expect(
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
    ).resolves.toEqual({
      run_id: "run-1",
      snapshot: {
        screen: "done",
      },
      log_path: "run-1.log",
    })
    expect(service.withWriterLock).toHaveBeenCalledWith("session-1", 1, expect.any(Function))
    expect(service.write).toHaveBeenCalledWith("session-1", 1, "echo done\r")
  })

  it("runs terminal writes inside the terminal queue", async () => {
    const service = createService()
    const order: string[] = []
    vi.mocked(service.withWriterLock).mockImplementation(async (_sessionId, _terminalId, fn) => {
      order.push("lock")
      const result = await fn()
      order.push("unlock")
      return result
    })
    vi.mocked(service.startRun).mockImplementation(async () => {
      order.push("start")
      return { runId: "run-1", path: "run-1.log" }
    })
    vi.mocked(service.write).mockImplementation(() => {
      order.push("write")
    })
    vi.mocked(service.agentSnapshot).mockResolvedValue({
      screen: "done",
    })

    await expect(
      tool("write_terminal", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
    ).resolves.toMatchObject({ run_id: "run-1" })

    expect(order).toEqual(["lock", "start", "write", "unlock"])
  })

  it("waits without writing when input is empty", async () => {
    const service = createService()
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", path: "run-1.log" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({ screen: "done" })

    await expect(
      tool("write_terminal", service).execute({ id: 1, input: "", submit: true, timeout: 0, idle: 0 }, ctx),
    ).resolves.toMatchObject({ run_id: "run-1", snapshot: { screen: "done" } })

    expect(service.write).not.toHaveBeenCalled()
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
})
