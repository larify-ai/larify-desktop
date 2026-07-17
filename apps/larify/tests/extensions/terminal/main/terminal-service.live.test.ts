import { describe, expect, it } from "vitest"
import { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"

const marker = "__LARIFY_TERMINAL_SERVICE_LIVE__"

function markerCommand(shell: string): string {
  if (process.platform === "win32" || shell.toLowerCase().endsWith("powershell.exe")) {
    return `Write-Output "${marker}"; exit 0\r`
  }
  return `printf "${marker}\\n"; exit 0\n`
}

describe.skipIf(!process.env.LIVE_TERMINAL)("TerminalService live", () => {
  it("creates a real default terminal and forwards output", async () => {
    const service = new TerminalService()
    const output = new Promise<string>((resolve, reject) => {
      const chunks: string[] = []
      const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal output")), 10_000)
      service.bindData((_sessionId, _terminalId, data) => {
        chunks.push(data)
        const text = chunks.join("")
        if (text.includes(marker)) {
          clearTimeout(timer)
          resolve(text)
        }
      })
    })

    const terminalId = service.create("service-live", { title: "Live" })
    const state = service.state("service-live")
    const shell = state.terminals.find((terminal) => terminal.id === terminalId)?.shell ?? ""
    service.write("service-live", terminalId, markerCommand(shell))

    expect(await output).toContain(marker)
    const snapshot = await service.snapshot("service-live", terminalId)
    expect(snapshot?.data).toContain(marker)
    await service.destroy()
  }, 15_000)

  it("receives PowerShell shell integration command completion", async () => {
    if (process.platform !== "win32") return
    const service = new TerminalService()
    const terminalId = service.create("shell-integration-live", { title: "Live" })
    const completion = new Promise<{ exitCode?: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for command completion")), 10_000)
      service.bindCommandFinished((sessionId, eventTerminalId, event) => {
        if (sessionId !== "shell-integration-live" || eventTerminalId !== terminalId) return
        clearTimeout(timer)
        resolve(event)
      })
    })

    service.write("shell-integration-live", terminalId, `Write-Output "${marker}"\r`)

    await expect(completion).resolves.toEqual({ exitCode: 0 })
    await service.destroy()
  }, 15_000)
})
