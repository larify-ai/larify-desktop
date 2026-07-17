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
  } as unknown as TerminalService
}

function tool(name: string, service: TerminalService) {
  const found = createTerminalToolkit(service).tools.find((item) => item.name === name)
  if (!found) throw new Error(`Tool ${name} not found`)
  return found
}

describe("terminal_close", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("terminal_close", service).execute({ id: 1 }, ctx)).rejects.toThrow(
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

    await expect(tool("terminal_close", service).execute({ id: 1 }, ctx)).resolves.toBe(
      "Closed terminal 1.",
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.close).toHaveBeenCalledWith("session-1", 1)
  })
})

describe("terminal_write", () => {
  it("returns the full terminal snapshot with run metadata", async () => {
    const service = createService()
    vi.mocked(service.startRun).mockResolvedValue({ runId: "run-1", path: "run-1.log" })
    vi.mocked(service.agentSnapshot).mockResolvedValue({
      screen: "done",
      isFullscreen: false,
      cursorLine: "PS>",
      visualHints: [],
    })

    await expect(
      tool("terminal_write", service).execute({ id: 1, input: "echo done", submit: true, timeout: 0, idle: 0 }, ctx),
    ).resolves.toEqual({
      run_id: "run-1",
      reason: "timeout",
      snapshot: {
        screen: "done",
        isFullscreen: false,
        cursorLine: "PS>",
        visualHints: [],
      },
      log_path: "run-1.log",
    })
    expect(service.write).toHaveBeenCalledWith("session-1", 1, "echo done\r")
  })
})

describe("terminal_read", () => {
  it("throws when the terminal does not exist", async () => {
    const service = createService()
    vi.mocked(service.terminalState).mockReturnValue(null)

    await expect(tool("terminal_read", service).execute({ id: 1 }, ctx)).rejects.toThrow(
      'Terminal "1" not found.',
    )
    expect(service.flushRunHistory).not.toHaveBeenCalled()
    expect(service.agentSnapshot).not.toHaveBeenCalled()
  })
})
