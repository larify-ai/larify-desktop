import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()
const logRoot = mkdtempSync(join(tmpdir(), "larify-cmdwait-"))

vi.mock("node-pty", () => ({ spawn: spawnMock }))
vi.mock("which", () => ({ default: { sync: (name: string) => name } }))
vi.mock("../../../../src/main/utils/app-paths", () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
  larifyTempPath: (...segments: string[]) => join(logRoot, "tmp", ...segments),
  larifyWorkspacePath: () => logRoot,
  resourcePath: (name: string) => join(logRoot, name),
}))

interface FakePty {
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  pid: number
  onData(cb: (data: string) => void): void
  onExit(cb: (event: { exitCode: number }) => void): void
  emit(data: string): void
}

function createFakePty(): FakePty {
  let onData: ((data: string) => void) | undefined
  return {
    pid: 4321,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData(cb) {
      onData = cb
    },
    onExit() {},
    emit(data) {
      onData?.(data)
    },
  }
}

const OSC = {
  started: "\x1b]633;C\x07",
  done: "\x1b]633;D;0\x07",
  prompt: "\x1b]633;A\x07\x1b]633;B\x07",
}

let fakePty: FakePty

beforeEach(() => {
  spawnMock.mockReset()
  fakePty = createFakePty()
  spawnMock.mockReturnValue(fakePty)
})

afterAll(() => {
  rmSync(logRoot, { force: true, recursive: true })
})

async function makeToolkit() {
  const { TerminalService } = await import("../../../../src/extensions/terminal/main/terminal-service")
  const { createTerminalToolkit } = await import("../../../../src/extensions/terminal/main/tools")
  const service = new TerminalService()
  const toolkit = createTerminalToolkit(service)
  const call = async <T>(name: string, input: Record<string, unknown>): Promise<T> => {
    const tool = toolkit.tools[name]
    const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input)
    const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
    return execute(parsed, {
      toolCallId: "t",
      messages: [],
      context: { sessionId: "cmdwait", cwd: logRoot },
      abortSignal: undefined,
    })
  }
  const id = (await call<{ id: number }>("create", { cwd: logRoot })).id
  return { service, call, id }
}

const screenOf = (result: unknown): string =>
  (result as { snapshot?: { screen?: string } }).snapshot?.screen ?? ""

const statusOf = (result: unknown): string => (result as { status?: string }).status ?? ""

describe("waiting for a run that contains more than one command", () => {
  it("keeps waiting when another command starts after the first finishes", async () => {
    const { service, call, id } = await makeToolkit()

    const pending = call("write", { id, input: "one\ntwo", submit: true, timeout: 30 })

    await vi.waitFor(() => expect(fakePty.write).toHaveBeenCalled())
    fakePty.emit(`${OSC.started}FIRST\r\n${OSC.done}${OSC.prompt}`)
    await new Promise((r) => setTimeout(r, 200))
    fakePty.emit(OSC.started)
    await new Promise((r) => setTimeout(r, 1400))
    fakePty.emit(`SECOND\r\n${OSC.done}${OSC.prompt}`)

    const screen = screenOf(await pending)
    expect(screen).toContain("FIRST")
    expect(screen).toContain("SECOND")
    await service.destroy()
  }, 30_000)

  it("returns after a single command settles", async () => {
    const { service, call, id } = await makeToolkit()

    const pending = call("write", { id, input: "one", submit: true, timeout: 30 })

    await vi.waitFor(() => expect(fakePty.write).toHaveBeenCalled())
    fakePty.emit(`${OSC.started}ONLY\r\n${OSC.done}${OSC.prompt}`)

    const result = await pending
    expect(screenOf(result)).toContain("ONLY")
    expect(statusOf(result)).toContain("finish event received")
    await service.destroy()
  }, 30_000)

  it("still gives up at the timeout when no command ever finishes", async () => {
    const { service, call, id } = await makeToolkit()

    const pending = call("write", { id, input: "server", submit: true, timeout: 2 })

    await vi.waitFor(() => expect(fakePty.write).toHaveBeenCalled())
    fakePty.emit(`${OSC.started}LISTENING\r\n`)

    const result = await pending
    expect(screenOf(result)).toContain("LISTENING")
    expect(statusOf(result)).toContain("may still be running")
    await service.destroy()
  }, 30_000)
})

describe("a finished command does not close the run", () => {
  it("logs output produced after the first command finished", async () => {
    const { service, call, id } = await makeToolkit()

    const pending = call("write", { id, input: "one\ntwo", submit: true, timeout: 30 })

    await vi.waitFor(() => expect(fakePty.write).toHaveBeenCalled())
    const bulk = Array.from({ length: 2600 }, (_, i) => `A${i + 1}`).join("\r\n")
    fakePty.emit(`${OSC.started}${bulk}\r\n${OSC.done}${OSC.prompt}`)
    await new Promise((r) => setTimeout(r, 200))
    fakePty.emit(OSC.started)
    await new Promise((r) => setTimeout(r, 300))
    fakePty.emit(`TAIL-MARKER\r\n${OSC.done}${OSC.prompt}`)

    const result = await pending
    expect(screenOf(result)).toContain("TAIL-MARKER")
    await service.destroy()
  }, 30_000)
})
