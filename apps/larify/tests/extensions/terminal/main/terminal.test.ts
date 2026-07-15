import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()

vi.mock("node-pty", () => ({
  spawn: spawnMock,
}))

interface FakePty {
  pid: number
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData(callback: (data: string) => void): void
  onExit(callback: (event: { exitCode: number }) => void): void
  emitData(data: string): void
  emitExit(exitCode: number): void
}

function createFakePty(): FakePty {
  let onData: ((data: string) => void) | undefined
  let onExit: ((event: { exitCode: number }) => void) | undefined
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(callback) {
      onData = callback
    },
    onExit(callback) {
      onExit = callback
    },
    emitData(data) {
      onData?.(data)
    },
    emitExit(exitCode) {
      onExit?.({ exitCode })
    },
  }
}

const cwd = join(tmpdir(), "larify-terminal-test")

beforeEach(() => {
  mkdirSync(cwd, { recursive: true })
  spawnMock.mockReset()
})

afterAll(() => {
  rmSync(cwd, { force: true, recursive: true })
})

async function importTerminal() {
  return import("../../../../src/extensions/terminal/main/terminal")
}

describe("Terminal", () => {
  it("spawns a pty with the provided shell, cwd, and initial size", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()

    const terminal = new Terminal(7, { shell: "powershell.exe", cwd, cols: 120, rows: 40 })

    expect(spawnMock).toHaveBeenCalledWith("powershell.exe", [], {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd,
      env: process.env,
    })
    expect(terminal.state()).toMatchObject({
      id: 7,
      pid: 1234,
      title: "powershell",
      cwd,
      shell: "powershell.exe",
      exitCode: null,
    })
  })

  it("requires shell and cwd", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()

    expect(() => new Terminal(1, { cwd })).toThrow("Terminal shell is required")
    expect(() => new Terminal(1, { shell: "sh" })).toThrow("Terminal cwd is required")
    expect(() => new Terminal(1, { shell: "sh", cwd: join(cwd, "missing") })).toThrow(
      "Terminal cwd does not exist",
    )
  })

  it("uses the provided title", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()

    const terminal = new Terminal(1, { shell: "sh", cwd, title: "Shell" })

    expect(terminal.state().title).toBe("Shell")
  })

  it("captures output in a capped snapshot", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitData("first")
    fakePty.emitData("second")

    expect(terminal.snapshot()).toBe("firstsecond")

    fakePty.emitData("x".repeat(1024 * 1024 + 10))

    expect(terminal.snapshot()).toHaveLength(1024 * 1024)
    expect(terminal.snapshot()).toBe("x".repeat(1024 * 1024))
  })

  it("trims the oldest chunk when the snapshot exceeds the cap", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitData("a".repeat(1024 * 1024 - 2))
    fakePty.emitData("bcde")

    expect(terminal.snapshot()).toHaveLength(1024 * 1024)
    expect(terminal.snapshot().startsWith("a")).toBe(true)
    expect(terminal.snapshot().endsWith("bcde")).toBe(true)
  })

  it("forwards writes and clamps resize dimensions", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    terminal.write("echo hello\r")
    terminal.resize(0, -5)

    expect(fakePty.write).toHaveBeenCalledWith("echo hello\r")
    expect(fakePty.resize).toHaveBeenCalledWith(1, 1)
  })

  it("delays exit until the final data flush window passes", async () => {
    vi.useFakeTimers()
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const onExit = vi.fn()
    terminal.bindExit(onExit)

    fakePty.emitExit(42)

    expect(onExit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onExit).toHaveBeenCalledWith(42)
    expect(terminal.state().exitCode).toBe(42)
    vi.useRealTimers()
  })

  it("supports multiple data listeners and unbinding", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const first = vi.fn()
    const second = vi.fn()
    terminal.bindData(first)
    const unbindSecond = terminal.bindData(second)

    fakePty.emitData("before")
    unbindSecond()
    fakePty.emitData("after")

    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith("before")
  })

  it("ignores writes after exit is flushed", async () => {
    vi.useFakeTimers()
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitExit(0)
    vi.advanceTimersByTime(250)
    terminal.write("echo late\r")

    expect(fakePty.write).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
