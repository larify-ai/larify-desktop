import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { Terminal } from "../../../../src/extensions/terminal/main/terminal"

const cwd = join(tmpdir(), "larify-terminal-live-test")
const marker = "__LARIFY_TERMINAL_LIVE__"

function shell(): string {
  if (process.platform === "win32") return "powershell.exe"
  return process.env.SHELL || "/bin/sh"
}

function markerCommand(): string {
  if (process.platform === "win32") return `Write-Output "${marker}"; exit 0\r`
  return `printf "${marker}\\n"; exit 0\n`
}

function waitForExit(terminal: Terminal, timeoutMs = 10_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal exit")), timeoutMs)
    terminal.bindExit((exitCode) => {
      clearTimeout(timer)
      resolve(exitCode)
    })
  })
}

describe.skipIf(!process.env.LIVE_TERMINAL)("Terminal live", () => {
  it("runs a real shell command and captures output", async () => {
    rmSync(cwd, { force: true, recursive: true })
    mkdirSync(cwd, { recursive: true })
    const terminal = new Terminal(1, { shell: shell(), cwd, cols: 80, rows: 24 })
    const exit = waitForExit(terminal)

    terminal.write(markerCommand())

    expect(await exit).toBe(0)
    const snapshot = await terminal.snapshot()
    expect(snapshot.data).toContain(marker)
    expect(snapshot).toMatchObject({ cols: 80, rows: 24 })
    expect(terminal.state().exitCode).toBe(0)
  }, 15_000)
})
