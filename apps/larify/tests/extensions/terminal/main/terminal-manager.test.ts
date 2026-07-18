import { rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const terminals: FakeTerminal[] = []
const logRoot = join(tmpdir(), "larify-terminal-manager-runs")

class FakeTerminal {
  readonly id: number
  readonly title: string
  readonly shell: string
  readonly cwd: string
  readonly pid: number
  write = vi.fn()
  resize = vi.fn()
  close = vi.fn()
  kill = vi.fn()
  private cursorRow = 0
  private baseY = 0
  private endRow = 0
  private rendered = new Map<number, string>()
  private dataCallbacks = new Set<(data: string, start: number, end: number) => void>()
  private exitCallbacks = new Set<(exitCode: number) => void>()
  private commandFinishedCallbacks = new Set<(event: { exitCode?: number }) => void>()

  constructor(id: number, opts: { title?: string; shell?: string; cwd?: string } = {}) {
    this.id = id
    this.title = opts.title ?? `Terminal ${id}`
    this.shell = opts.shell ?? "sh"
    this.cwd = opts.cwd ?? "/tmp"
    this.pid = 1000 + id
    terminals.push(this)
  }

  bindData(callback: (data: string, start: number, end: number) => void): () => void {
    this.dataCallbacks.add(callback)
    return () => this.dataCallbacks.delete(callback)
  }

  bindExit(callback: (exitCode: number) => void): () => void {
    this.exitCallbacks.add(callback)
    return () => this.exitCallbacks.delete(callback)
  }

  bindCommandFinished(callback: (event: { exitCode?: number }) => void): () => void {
    this.commandFinishedCallbacks.add(callback)
    return () => this.commandFinishedCallbacks.delete(callback)
  }

  snapshot(): string {
    return `snapshot:${this.id}`
  }

  agentSnapshot(opts: { startRow?: number } = {}): { screen: string } {
    const startRow = opts.startRow ?? 0
    const lines: string[] = []
    for (let row = startRow; row <= this.endRow; row++) lines.push(this.rendered.get(row) ?? "")
    return { screen: lines.join("\n") }
  }

  currentRenderedRow(): number {
    return this.cursorRow
  }

  flushRenderedRowsBeforeTail(
    flushedUntilRow: number,
    tailLines: number
  ): { text: string; flushedUntilRow: number } | null {
    const safeEnd = Math.min(this.baseY - tailLines, this.endRow)
    const startRow = flushedUntilRow + 1
    if (safeEnd < startRow) return null
    const lines: string[] = []
    for (let row = startRow; row <= safeEnd; row++) lines.push(this.rendered.get(row) ?? "")
    return {
      text: lines.join("\n").replace(/^\n+|\n+$/g, ""),
      flushedUntilRow: safeEnd,
    }
  }

  setRendered(lines: string[], baseY = 0): void {
    this.rendered.clear()
    lines.forEach((line, index) => this.rendered.set(index, line))
    this.cursorRow = lines.length - 1
    this.endRow = lines.length - 1
    this.baseY = baseY
  }

  state(): {
    id: number
    pid: number
    title: string
    cwd: string
    shell: string
    exitCode: null
  } {
    return {
      id: this.id,
      pid: this.pid,
      title: this.title,
      cwd: this.cwd,
      shell: this.shell,
      exitCode: null,
    }
  }

  emitData(data: string, start = 0, end = data.length): void {
    for (const callback of this.dataCallbacks) callback(data, start, end)
  }

  emitExit(exitCode: number): void {
    for (const callback of this.exitCallbacks) callback(exitCode)
  }
}

vi.mock("../../../../src/extensions/terminal/main/terminal", () => ({
  Terminal: FakeTerminal,
}))

vi.mock("../../../../src/main/utils/app-paths", () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
}))

async function importManager(): Promise<
  typeof import("../../../../src/extensions/terminal/main/terminal-manager")
> {
  return import("../../../../src/extensions/terminal/main/terminal-manager")
}

beforeEach(() => {
  terminals.length = 0
  rmSync(logRoot, { force: true, recursive: true })
})

describe("TerminalManager", () => {
  it("creates terminals and marks the newest as active", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const onChange = vi.fn()
    manager.bindChange(onChange)

    const first = manager.create({ shell: "sh", cwd: "/tmp", title: "Shell" })
    const second = manager.create({ shell: "bash", cwd: "/tmp", title: "Bash" })

    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(manager.state()).toMatchObject({
      sessionId: "session-1",
      activeId: 2,
      terminals: [
        { id: 1, title: "Shell" },
        { id: 2, title: "Bash" },
      ],
    })
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("forwards write and resize to the target terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()

    manager.write(id, "echo hello\n")
    manager.resize(id, 120, 30)

    expect(terminals[0].write).toHaveBeenCalledWith("echo hello\n")
    expect(terminals[0].resize).toHaveBeenCalledWith(120, 30)
  })

  it("queues writers per terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    let release!: () => void
    const calls: string[] = []
    const first = manager.withWriterLock(
      id,
      () =>
        new Promise<string>((resolve) => {
          calls.push("first")
          release = () => resolve("done")
        }),
    )
    const second = manager.withWriterLock(id, async () => {
      calls.push("second")
      return "second"
    })

    await vi.waitFor(() => expect(calls).toEqual(["first"]))

    release()
    await expect(first).resolves.toBe("done")
    await expect(second).resolves.toBe("second")
    expect(calls).toEqual(["first", "second"])
  })

  it("queues close behind terminal writers", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    let release!: () => void
    const run = manager.withWriterLock(
      id,
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    const close = manager.close(id)
    await Promise.resolve()
    expect(terminals[0].close).not.toHaveBeenCalled()

    release()
    await run
    await expect(close).resolves.toBeUndefined()
    expect(terminals[0].close).toHaveBeenCalled()
  })

  it("emits data and exit events with terminal ids", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const onData = vi.fn()
    const onExit = vi.fn()
    manager.bindData(onData)
    manager.bindExit(onExit)
    manager.create()

    terminals[0].emitData("output")
    terminals[0].emitExit(3)

    expect(onData).toHaveBeenCalledWith(1, "output", 0, 6)
    expect(onExit).toHaveBeenCalledWith(1, 3)
  })

  it("supports multiple listeners and unbinding", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const first = vi.fn()
    const second = vi.fn()
    manager.bindData(first)
    const unbindSecond = manager.bindData(second)
    manager.create()

    terminals[0].emitData("before")
    unbindSecond()
    terminals[0].emitData("after")

    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledWith(1, "before", 0, 6)
  })

  it("sets active only for known terminals", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const onChange = vi.fn()
    manager.bindChange(onChange)
    const first = manager.create()
    manager.create()
    onChange.mockClear()

    manager.setActive(first)
    manager.setActive(999)

    expect(manager.state().activeId).toBe(first)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it("reorders terminals", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const onChange = vi.fn()
    manager.bindChange(onChange)
    const first = manager.create()
    const second = manager.create()
    const third = manager.create()
    onChange.mockClear()

    manager.reorder(third, 0)
    manager.reorder(first, 99)
    manager.reorder(999, 0)

    expect(manager.state().terminals.map((terminal) => terminal.id)).toEqual([third, second, first])
    expect(manager.state().activeId).toBe(third)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it("returns snapshots and closes terminals while selecting the next active terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const first = manager.create()
    const second = manager.create()
    const third = manager.create()
    manager.setActive(second)

    expect(manager.snapshot(second)).toBe("snapshot:2")

    await manager.close(second)

    expect(terminals[1].close).toHaveBeenCalled()
    expect(manager.state().activeId).toBe(third)
    expect(manager.state().terminals.map((terminal) => terminal.id)).toEqual([first, third])
  })

  it("starts run logs and appends rendered history", async () => {
    const { readFile } = await import("node:fs/promises")
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["prompt"])

    const log = await manager.startRun(id)
    terminals[0].setRendered(["prompt", "line 1", "line 2"], 0)
    await manager.flushRunHistory(id)

    expect(log?.path).toBeUndefined()

    terminals[0].setRendered(["old", "kept", "tail"], 201)
    await manager.flushRunHistory(id)

    expect(log?.path).toContain("sessions")
    await expect(readFile(log!.path, "utf8")).resolves.toContain("old\nkept")
  })

  it("returns the current agent snapshot for active runs", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["old prompt"])

    await manager.startRun(id)
    terminals[0].setRendered(["old prompt", "new line 1", "new line 2"])

    await expect(manager.agentSnapshot(id)).resolves.toEqual({
      screen: "old prompt\nnew line 1\nnew line 2",
    })

    terminals[0].setRendered(["old prompt", "new line 1", "new line 2", "new line 3"])
    await expect(manager.agentSnapshot(id)).resolves.toEqual({
      screen: "old prompt\nnew line 1\nnew line 2\nnew line 3",
    })
  })

  it("does not include flushed active run history in agent snapshots", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["prompt"])

    await manager.startRun(id)
    terminals[0].setRendered(["old", "kept", "tail"], 201)

    await expect(manager.agentSnapshot(id)).resolves.toEqual({
      screen: "tail",
    })
  })

  it("flushes active run history before closing a terminal", async () => {
    const { readFile } = await import("node:fs/promises")
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["prompt"])

    const log = await manager.startRun(id)
    terminals[0].setRendered(["old", "kept", "tail"], 2001)
    await manager.close(id)

    expect(terminals[0].close).toHaveBeenCalled()
    await expect(readFile(log!.path, "utf8")).resolves.toContain("old\nkept")
  })

  it("auto-checks active run output and only writes history past the tail window", async () => {
    const { readFile } = await import("node:fs/promises")
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["prompt"])

    const log = await manager.startRun(id)
    terminals[0].setRendered(["prompt", "line 1"], 0)
    terminals[0].emitData("chunk")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log?.path).toBeUndefined()

    terminals[0].setRendered(["old", "kept", "tail"], 2001)
    terminals[0].emitData("chunk")
    await expect
      .poll(async () => {
        if (!log?.path) return ""
        try {
          return await readFile(log.path, "utf8")
        } catch {
          return ""
        }
      })
      .toContain("old\nkept")
  })

  it("flushes active run history before destroying terminals", async () => {
    const { readFile } = await import("node:fs/promises")
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const id = manager.create()
    terminals[0].setRendered(["prompt"])

    const log = await manager.startRun(id)
    terminals[0].setRendered(["old", "kept", "tail"], 2001)
    await manager.destroy()

    expect(terminals[0].kill).toHaveBeenCalled()
    await expect(readFile(log!.path, "utf8")).resolves.toContain("old\nkept")
  })

  it("destroys every terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    manager.create()
    manager.create()

    await manager.destroy()

    expect(terminals[0].kill).toHaveBeenCalled()
    expect(terminals[1].kill).toHaveBeenCalled()
    expect(manager.state()).toMatchObject({ activeId: null, terminals: [] })
  })
})
