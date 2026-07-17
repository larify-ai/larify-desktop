import { describe, expect, it } from "vitest"
import { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"

const marker = "__LARIFY_TERMINAL_SERVICE_LIVE__"
const startMarker = "__LARIFY_TERMINAL_START__"
const doneMarker = "__LARIFY_TERMINAL_DONE__"

function markerCommand(shell: string): string {
  if (process.platform === "win32" || shell.toLowerCase().endsWith("powershell.exe")) {
    return `Write-Output "${marker}"; exit 0\r`
  }
  return `printf "${marker}\\n"; exit 0\n`
}

function commandCompletionCase(shell: string): void {
  it(`waits for command completion in ${shell}`, async () => {
    const service = new TerminalService()
    const terminalId = service.create(`${shell}-shell-integration-live`, { shell, title: "Live" })
    const state = service.state(`${shell}-shell-integration-live`)
    const terminal = state.terminals.find((candidate) => candidate.id === terminalId)
    const chunks: string[] = []

    expect(terminal?.shellIntegration).toBe(true)

    const completion = new Promise<{ exitCode?: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for command completion")), 10_000)
      service.bindCommandFinished((sessionId, eventTerminalId, event) => {
        if (sessionId !== `${shell}-shell-integration-live` || eventTerminalId !== terminalId) return
        clearTimeout(timer)
        resolve(event)
      })
    })

    const output = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for terminal output")), 10_000)
      service.bindData((sessionId, eventTerminalId, data) => {
        if (sessionId !== `${shell}-shell-integration-live` || eventTerminalId !== terminalId) return
        chunks.push(data)
        const text = chunks.join("")
        if (text.includes(startMarker) && text.includes(doneMarker)) {
          clearTimeout(timer)
          resolve(text)
        }
      })
    })

    service.write(
      `${shell}-shell-integration-live`,
      terminalId,
      `printf "${startMarker}\\n"; sleep 5; printf "${doneMarker}\\n"\n`,
    )

    try {
      const event = await completion
      if (event.exitCode !== undefined) expect(event.exitCode).toBe(0)
      expect(await output).toContain(doneMarker)
    } catch (error) {
      const snapshot = await service.snapshot(`${shell}-shell-integration-live`, terminalId)
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          "--- terminal raw output ---",
          chunks.join(""),
          "--- terminal snapshot ---",
          snapshot?.data ?? "<no snapshot>",
        ].join("\n"),
      )
    } finally {
      await service.destroy()
    }
  }, 15_000)
}

describe("TerminalService live", () => {
  it("creates a real default terminal and forwards output", async () => {
    if (!process.env.LIVE_TERMINAL) return
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
    if (!process.env.LIVE_TERMINAL || process.platform !== "win32") return
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

  describe.skipIf(!process.env.LIVE_TERMINAL_BASH)("bash shell integration", () => {
    commandCompletionCase("/bin/bash")
  })

  describe.skipIf(!process.env.LIVE_TERMINAL_ZSH)("zsh shell integration", () => {
    commandCompletionCase("/bin/zsh")
  })
})
