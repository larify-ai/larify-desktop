import { beforeEach, describe, expect, it, vi } from "vitest"

const terminals: FakeTerminal[] = []

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
  private dataCallbacks = new Set<(data: string) => void>()
  private exitCallbacks = new Set<(exitCode: number) => void>()

  constructor(id: number, opts: { title?: string; shell?: string; cwd?: string } = {}) {
    this.id = id
    this.title = opts.title ?? `Terminal ${id}`
    this.shell = opts.shell ?? "sh"
    this.cwd = opts.cwd ?? "/tmp"
    this.pid = 1000 + id
    terminals.push(this)
  }

  bindData(callback: (data: string) => void): () => void {
    this.dataCallbacks.add(callback)
    return () => this.dataCallbacks.delete(callback)
  }

  bindExit(callback: (exitCode: number) => void): () => void {
    this.exitCallbacks.add(callback)
    return () => this.exitCallbacks.delete(callback)
  }

  snapshot(): string {
    return `snapshot:${this.id}`
  }

  state() {
    return {
      id: this.id,
      pid: this.pid,
      title: this.title,
      cwd: this.cwd,
      shell: this.shell,
      exitCode: null,
    }
  }

  emitData(data: string): void {
    for (const callback of this.dataCallbacks) callback(data)
  }

  emitExit(exitCode: number): void {
    for (const callback of this.exitCallbacks) callback(exitCode)
  }
}

vi.mock("../../../../src/extensions/terminal/main/terminal", () => ({
  Terminal: FakeTerminal,
}))

async function importManager() {
  return import("../../../../src/extensions/terminal/main/terminal-manager")
}

beforeEach(() => {
  terminals.length = 0
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

    expect(onData).toHaveBeenCalledWith(1, "output")
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
    expect(second).toHaveBeenCalledWith(1, "before")
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

  it("returns snapshots and closes terminals while selecting the next active terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    const first = manager.create()
    const second = manager.create()
    const third = manager.create()
    manager.setActive(second)

    expect(manager.snapshot(second)).toBe("snapshot:2")

    manager.close(second)

    expect(terminals[1].close).toHaveBeenCalled()
    expect(manager.state().activeId).toBe(third)
    expect(manager.state().terminals.map((terminal) => terminal.id)).toEqual([first, third])
  })

  it("destroys every terminal", async () => {
    const { TerminalManager } = await importManager()
    const manager = new TerminalManager("session-1")
    manager.create()
    manager.create()

    manager.destroy()

    expect(terminals[0].kill).toHaveBeenCalled()
    expect(terminals[1].kill).toHaveBeenCalled()
    expect(manager.state()).toMatchObject({ activeId: null, terminals: [] })
  })
})
