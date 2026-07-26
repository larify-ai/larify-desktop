import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()
const logRoot = mkdtempSync(join(tmpdir(), "larify-abort-"))

vi.mock("node-pty", () => ({ spawn: spawnMock }))
vi.mock("which", () => ({ default: { sync: (name: string) => name } }))
vi.mock("../../../../src/main/utils/app-paths", () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
  larifyTempPath: (...segments: string[]) => join(logRoot, "tmp", ...segments),
  larifyWorkspacePath: () => logRoot,
  resourcePath: (name: string) => join(logRoot, name),
}))

beforeEach(() => {
  spawnMock.mockReset()
  spawnMock.mockReturnValue({
    pid: 1,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => {},
    onExit: () => {},
  })
})

afterAll(() => rmSync(logRoot, { force: true, recursive: true }))

async function boot() {
  const { TerminalService } = await import("../../../../src/extensions/terminal/main/terminal-service")
  const { createTerminalToolkit } = await import("../../../../src/extensions/terminal/main/tools")
  const service = new TerminalService()
  const toolkit = createTerminalToolkit(service)
  const call = <T>(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> => {
    const tool = toolkit.tools[name]
    const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input)
    const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<T>
    return execute(parsed, {
      toolCallId: "t",
      messages: [],
      context: { sessionId: "abort", cwd: logRoot },
      abortSignal: signal,
    })
  }
  const id = service.create("abort", { cwd: logRoot })
  return { service, call, id }
}

describe("a stopped tool call stops waiting", () => {
  it("returns promptly when write is aborted mid-wait", async () => {
    const { service, call, id } = await boot()
    const controller = new AbortController()
    const startedAt = Date.now()

    const pending = call("write", { id, input: "sleep", submit: true, timeout: 10, idle: 0 }, controller.signal)
    setTimeout(() => controller.abort(), 200)
    await pending

    expect(Date.now() - startedAt).toBeLessThan(3000)
    await service.destroy()
  }, 30_000)

  it("returns promptly when read is aborted mid-wait", async () => {
    const { service, call, id } = await boot()
    const controller = new AbortController()
    const startedAt = Date.now()

    const pending = call("read", { id, timeout: 10, idle: 10 }, controller.signal)
    setTimeout(() => controller.abort(), 200)
    await pending

    expect(Date.now() - startedAt).toBeLessThan(3000)
    await service.destroy()
  }, 30_000)

  it("does not wait at all when the signal is already aborted", async () => {
    const { service, call, id } = await boot()
    const startedAt = Date.now()

    await call("read", { id, timeout: 10, idle: 10 }, AbortSignal.abort())

    expect(Date.now() - startedAt).toBeLessThan(1500)
    await service.destroy()
  }, 30_000)
})
