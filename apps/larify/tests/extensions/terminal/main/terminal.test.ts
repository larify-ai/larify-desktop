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

type Savable = { lines: string[]; commit(): void; discard(): void } | null

async function drainFront(
  terminal: { takeSavableFront(keepTail: number): Promise<Savable> },
  keepTail: number,
): Promise<string[]> {
  const front = await terminal.takeSavableFront(keepTail)
  if (!front) return []
  front.commit()
  return front.lines
}

async function drainAll(terminal: { takeAllRemaining(): Promise<Savable> }): Promise<string[]> {
  const front = await terminal.takeAllRemaining()
  if (!front) return []
  front.commit()
  return front.lines
}

beforeEach(() => {
  mkdirSync(cwd, { recursive: true })
  spawnMock.mockReset()
})

afterAll(() => {
  rmSync(cwd, { force: true, recursive: true })
})

async function importTerminal(): Promise<
  typeof import("../../../../src/extensions/terminal/main/terminal")
> {
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

  it("reads run tail scoped to the run start, excluding earlier content", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 4 })

    fakePty.emitData("PREV1\r\nPREV2\r\nprompt> ")
    await terminal.beginRun()
    fakePty.emitData("cmd\r\nOUT1\r\nOUT2\r\n")
    const output = await terminal.readRunTail(10000)

    expect(output.some((line) => line.startsWith("PREV"))).toBe(false)
    expect(output).toContain("OUT1")
    expect(output).toContain("OUT2")
  })

  it("reads a wrapped long line as ordered physical rows", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 10, rows: 6 })
    await terminal.beginRun()

    fakePty.emitData("ABCDEFGHIJKLMNOPQRSTUVWXY\r\n")
    const output = await terminal.readRunTail(10000)

    expect(output.slice(0, 3)).toEqual(["ABCDEFGHIJ", "KLMNOPQRST", "UVWXY"])
    expect(output.slice(0, 3).join("")).toBe("ABCDEFGHIJKLMNOPQRSTUVWXY")
  })

  it("keeps all run output when the terminal is resized mid-run", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 40, rows: 4 })
    await terminal.beginRun()

    fakePty.emitData(Array.from({ length: 20 }, (_, i) => `R${i + 1}`).join("\r\n") + "\r\n")
    terminal.resize(12, 4)
    fakePty.emitData(Array.from({ length: 20 }, (_, i) => `R${i + 21}`).join("\r\n") + "\r\n")
    const output = await terminal.readRunTail(10000)

    for (let k = 1; k <= 40; k++) expect(output).toContain(`R${k}`)
  })

  it("persists run output past the scrollback cap without loss", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 24 })
    await terminal.beginRun()

    const saved: string[] = []
    const total = 14000
    for (let chunk = 0; chunk < total; chunk += 200) {
      const lines = Array.from({ length: 200 }, (_, i) => `N${chunk + i + 1}`)
      fakePty.emitData(lines.join("\r\n") + "\r\n")
      saved.push(...(await drainFront(terminal, 2000)))
    }
    saved.push(...(await drainFront(terminal, 2000)))
    const tail = await terminal.readRunTail(2000)
    saved.push(...(await drainAll(terminal)))

    const covered = new Set([...saved, ...tail])
    const missing: number[] = []
    for (let k = 1; k <= total; k++) if (!covered.has(`N${k}`)) missing.push(k)
    expect(missing).toEqual([])
  })

  it("does not re-persist the last line when output continues after takeAllRemaining", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 24 })
    await terminal.beginRun()

    fakePty.emitData("A1\r\nA2\r\nA3\r\nLAST")
    const first = await drainAll(terminal)
    fakePty.emitData("\r\nB1\r\nB2\r\n")
    const second = await drainAll(terminal)

    expect(first).toContain("LAST")
    expect(second).not.toContain("LAST")
    const all = [...first, ...second]
    for (const line of ["A1", "A2", "A3", "LAST", "B1", "B2"]) {
      expect(all.filter((entry) => entry === line)).toHaveLength(1)
    }
  })

  it("keeps logging after a burst pushes the saved marker out of the scrollback", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 24 })
    await terminal.beginRun()

    fakePty.emitData(Array.from({ length: 12000 }, (_, i) => `N${i + 1}`).join("\r\n") + "\r\n")
    const front = await drainFront(terminal, 2000)
    fakePty.emitData(Array.from({ length: 500 }, (_, i) => `M${i + 1}`).join("\r\n") + "\r\n")
    const rest = await drainAll(terminal)

    expect(front.length).toBeGreaterThan(0)
    expect(rest).toContain("M500")
    expect([...front, ...rest]).toContain("N12000")
  })

  it("logs only this run when it started while an alternate-buffer TUI was on screen", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 24 })

    fakePty.emitData(Array.from({ length: 500 }, (_, i) => `PREV${i + 1}`).join("\r\n") + "\r\n")
    fakePty.emitData("\x1b[?1049h")
    fakePty.emitData("tui-screen\r\n")
    await terminal.beginRun()
    fakePty.emitData("\x1b[?1049l")
    await drainFront(terminal, 10)
    fakePty.emitData(Array.from({ length: 100 }, (_, i) => `A${i + 1}`).join("\r\n") + "\r\n")

    const front = await drainFront(terminal, 10)
    const rest = await drainAll(terminal)

    const logged = [...front, ...rest]
    for (let k = 1; k <= 100; k++) expect(logged).toContain(`A${k}`)
    expect(logged.some((line) => line.startsWith("PREV"))).toBe(false)
  })

  it("keeps rows below the cursor when a repaint parks the cursor higher", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 10 })
    await terminal.beginRun()

    fakePty.emitData("OUT1\r\nOUT2\r\nOUT3\r\nSTATUS-BOTTOM\r\n")
    fakePty.emitData("\x1b[3A")
    fakePty.emitData("PARKED")

    const rest = await drainAll(terminal)

    expect(rest).toEqual(["OUT1", "PARKED", "OUT3", "STATUS-BOTTOM"])
  })

  it("returns no run tail while an alternate-buffer TUI is active", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 4 })
    await terminal.beginRun()

    fakePty.emitData("\x1b[?1049h")
    fakePty.emitData("tui-line-1\r\ntui-line-2\r\n")

    expect(await terminal.readRunTail(10000)).toEqual([])
  })

  it("passes shell integration args and env to the pty", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()

    const terminal = new Terminal(1, {
      shell: "powershell.exe",
      cwd,
      shellArgs: ["-NoExit", "-Command", ". script.ps1"],
      shellEnv: { VSCODE_STABLE: "1" },
    })

    expect(spawnMock).toHaveBeenCalledWith("powershell.exe", ["-NoExit", "-Command", ". script.ps1"], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: { ...process.env, VSCODE_STABLE: "1" },
    })
    expect(terminal.state().shellIntegration).toBeUndefined()

    fakePty.emitData("\x1b]633;A\x07\x1b]633;B\x07")
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(terminal.state().shellIntegration).toBe(true)
  })

  it("never claims shell integration for a shell that stays silent", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, shellArgs: ["-i"] })

    fakePty.emitData("PS D:\\> hello\r\n")
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(terminal.state().shellIntegration).toBeUndefined()
  })

  it("emits shell command completion from VS Code OSC 633 markers", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const onCommandFinished = vi.fn()
    terminal.bindCommandFinished(onCommandFinished)

    fakePty.emitData("\x1b]633;D;0\x07")
    await terminal.snapshot()

    expect(onCommandFinished).toHaveBeenCalledWith({ exitCode: 0 })
  })

  it("tracks command running state from VS Code OSC 633 markers", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitData("\x1b]633;C\x07")
    await terminal.snapshot()
    expect(terminal.state().commandRunning).toBe(true)

    fakePty.emitData("\x1b]633;D\x07")
    await terminal.snapshot()
    expect(terminal.state().commandRunning).toBeUndefined()
  })

  it("parses OSC 633 exit codes and the E marker", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const onCommandFinished = vi.fn()
    terminal.bindCommandFinished(onCommandFinished)

    fakePty.emitData("\x1b]633;D\x07")
    await terminal.snapshot()
    expect(onCommandFinished).toHaveBeenLastCalledWith({})

    fakePty.emitData("\x1b]633;D;137\x07")
    await terminal.snapshot()
    expect(onCommandFinished).toHaveBeenLastCalledWith({ exitCode: 137 })

    fakePty.emitData("\x1b]633;D;abc\x07")
    await terminal.snapshot()
    expect(onCommandFinished).toHaveBeenLastCalledWith({})

    fakePty.emitData("\x1b]633;E\x07")
    await terminal.snapshot()
    expect(terminal.state().commandRunning).toBe(true)
  })

  it("serializes the rendered terminal state instead of raw output", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitData("first\rsecond")

    const snapshot = await terminal.snapshot()
    expect(snapshot).toMatchObject({ cols: 80, rows: 24, seq: 12 })
    expect(snapshot.data).toContain("second")
    expect(snapshot.data).not.toContain("first")
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
    expect(await terminal.snapshot()).toMatchObject({ cols: 1, rows: 1 })
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

  it("reschedules the exit flush for late data and fires exit exactly once", async () => {
    vi.useFakeTimers()
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const onExit = vi.fn()
    terminal.bindExit(onExit)

    fakePty.emitExit(0)
    vi.advanceTimersByTime(100)
    fakePty.emitData("trailing output")
    vi.advanceTimersByTime(200)
    expect(onExit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(onExit).toHaveBeenCalledTimes(1)

    fakePty.emitData("output after flush")
    vi.advanceTimersByTime(250)
    expect(onExit).toHaveBeenCalledTimes(1)
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
    expect(second).toHaveBeenCalledWith("before", 0, 6)
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

  it("keeps the saved marker in place when a front is discarded, re-offering the lines", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd, cols: 80, rows: 4 })
    await terminal.beginRun()

    fakePty.emitData(Array.from({ length: 20 }, (_, i) => `L${i + 1}`).join("\r\n") + "\r\n")
    const first = await terminal.takeSavableFront(2)
    first?.discard()

    const second = await terminal.takeSavableFront(2)
    second?.commit()

    expect(first?.lines.length).toBeGreaterThan(0)
    expect(second?.lines).toEqual(first?.lines)
  })

  it("dispose() tears down the headless terminal once and is idempotent", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })
    const headless = (terminal as unknown as { headless: { dispose: () => void } }).headless
    const spy = vi.spyOn(headless, "dispose")

    terminal.dispose()
    terminal.dispose()

    expect(spy).toHaveBeenCalledTimes(1)
  })

  it("serves the final snapshot after dispose instead of empty output or a crash", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    fakePty.emitData("hello world\r\n")
    await terminal.snapshot()
    terminal.dispose()

    await expect(terminal.snapshot()).resolves.toMatchObject({
      data: expect.stringContaining("hello world"),
    })
    await expect(terminal.agentSnapshot()).resolves.toMatchObject({
      screen: expect.stringContaining("hello world"),
    })
    await expect(terminal.readRunTail(100)).resolves.toEqual([])
    await expect(terminal.takeSavableFront(0)).resolves.toBeNull()
  })

  it("ignores stray pty data and exit that arrive after dispose", async () => {
    const fakePty = createFakePty()
    spawnMock.mockReturnValue(fakePty)
    const { Terminal } = await importTerminal()
    const terminal = new Terminal(1, { shell: "sh", cwd })

    terminal.dispose()

    expect(() => fakePty.emitData("late output")).not.toThrow()
    expect(() => fakePty.emitExit(0)).not.toThrow()
  })
})
