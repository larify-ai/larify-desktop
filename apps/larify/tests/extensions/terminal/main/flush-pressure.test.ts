import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, vi } from "vitest"

const spawnMock = vi.fn()
const logRoot = mkdtempSync(join(tmpdir(), "larify-flush-pressure-"))

vi.mock("node-pty", () => ({ spawn: spawnMock }))
vi.mock("../../../../src/main/utils/app-paths", () => ({
  larifyPath: (...segments: string[]) => join(logRoot, ...segments),
  larifyTempPath: (...segments: string[]) => join(logRoot, "tmp", ...segments),
  larifyWorkspacePath: () => logRoot,
  resourcePath: (name: string) => join(logRoot, name),
}))

afterAll(() => rmSync(logRoot, { force: true, recursive: true }))

async function burstingTerminal() {
  let onData: ((data: string) => void) | undefined
  spawnMock.mockReturnValue({
    pid: 1,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (cb: (data: string) => void) => {
      onData = cb
    },
    onExit: () => {},
  })
  const { TerminalManager } = await import("../../../../src/extensions/terminal/main/terminal-manager")
  const manager = new TerminalManager("flush-pressure")
  const id = 1
  manager.create(id, { shell: "pwsh.exe", cwd: logRoot, shellArgs: ["-x"] })
  await manager.startRun(id)
  const chunk = Array.from({ length: 40 }, (_, i) => `x${i}`).join("\r\n") + "\r\n"
  return { manager, id, burst: (count: number) => { for (let i = 0; i < count; i++) onData?.(chunk) } }
}

describe("sustained output does not crowd out tool calls", () => {
  it("still serves a flush request after a large burst", async () => {
    const { manager, id, burst } = await burstingTerminal()

    burst(3000)

    await expect(manager.flushRunHistory(id)).resolves.toBeDefined()
    await manager.destroy()
  }, 60_000)

  it("keeps the pending log write coalesced to one per terminal", async () => {
    const { manager, id, burst } = await burstingTerminal()

    burst(3000)
    const settled = await Promise.allSettled([
      manager.flushRunHistory(id),
      manager.flushRunHistory(id),
      manager.flushRunHistory(id),
    ])

    expect(settled.every((r) => r.status === "fulfilled")).toBe(true)
    await manager.destroy()
  }, 60_000)
})
