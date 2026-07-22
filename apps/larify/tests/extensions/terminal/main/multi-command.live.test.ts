import { readFileSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { TerminalService } from "../../../../src/extensions/terminal/main/terminal-service"
import { createTerminalToolkit } from "../../../../src/extensions/terminal/main/tools"

const cwd = mkdtempSync(join(tmpdir(), "zz-multi-"))

const call = async (toolkit: ReturnType<typeof createTerminalToolkit>, name: string, input: unknown) => {
  const tool = toolkit.tools[name]
  const parsed = (tool.inputSchema as unknown as { parse: (v: unknown) => unknown }).parse(input)
  const execute = tool.execute as unknown as (i: unknown, o: unknown) => Promise<unknown>
  return execute(parsed, {
    toolCallId: "t",
    messages: [],
    context: { sessionId: "zz-multi", cwd },
    abortSignal: undefined,
  })
}

describe.skipIf(!process.env.LIVE_TERMINAL)("two commands in one write", () => {
  it("returns the output of both and logs both", async () => {
    const service = new TerminalService()
    const toolkit = createTerminalToolkit(service)
    const created = (await call(toolkit, "create", { cwd })) as { id: number }

    await call(toolkit, "write", { id: created.id, input: "Write-Output WARMUP", submit: true, timeout: 60 })

    const result = (await call(toolkit, "write", {
      id: created.id,
      input: "Write-Output FIRST\nStart-Sleep -Milliseconds 1200; Write-Output SECOND",
      submit: true,
      timeout: 60,
    })) as { status?: string; snapshot?: { screen?: string }; log_path?: string }

    const screen = result.snapshot?.screen ?? ""
    const logged = result.log_path ? readFileSync(result.log_path, "utf8") : ""
    const everything = `${screen}\n${logged}`

    console.log("ZZ>>> status:", result.status)
    console.log("ZZ>>> screen has FIRST :", screen.includes("FIRST"))
    console.log("ZZ>>> screen has SECOND:", screen.includes("SECOND"))
    console.log("ZZ>>> log_path         :", result.log_path ?? "(none)")

    expect(everything).toContain("FIRST")
    expect(everything).toContain("SECOND")

    await service.destroy()
  }, 90_000)
})
