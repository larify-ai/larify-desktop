import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { TerminalManager } from "../../../../src/extensions/terminal/main/terminal-manager"

const cwd = join(tmpdir(), "larify-terminal-manager-live-test")
const marker = "__LARIFY_TERMINAL_MANAGER_LIVE__"

function shell(): string {
  if (process.platform === "win32") return "powershell.exe"
  return process.env.SHELL || "/bin/sh"
}

function markerCommand(): string {
  if (process.platform === "win32") return `Write-Output "${marker}"; exit 0\r`
  return `printf "${marker}\\n"; exit 0\n`
}

describe.skipIf(!process.env.LIVE_TERMINAL)("TerminalManager live", () => {
  it("creates a real terminal and forwards output through the manager", async () => {
    rmSync(cwd, { force: true, recursive: true })
    mkdirSync(cwd, { recursive: true })
    const manager = new TerminalManager("session-live")
    const data = new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal data")), 10_000)
      manager.bindData((_terminalId, chunk) => {
        chunks.push(chunk)
        const output = chunks.join("")
        if (output.includes(marker)) {
          clearTimeout(timer)
          resolve(output)
        }
      })
    })

    const id = manager.create({ shell: shell(), cwd, title: "Live Shell" })
    manager.write(id, markerCommand())

    expect(await data).toContain(marker)
    expect(manager.snapshot(id)).toContain(marker)
    manager.destroy()
  }, 15_000)
})
