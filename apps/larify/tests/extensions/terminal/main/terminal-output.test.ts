import { Terminal as HeadlessTerminal } from "@xterm/headless"
import { describe, expect, it } from "vitest"
import { readAgentSnapshot } from "../../../../src/extensions/terminal/main/terminal-output"

const write = (terminal: HeadlessTerminal, data: string): Promise<void> =>
  new Promise((resolve) => terminal.write(data, resolve))

describe("terminal output", () => {
  it("includes the cursor line in agent snapshots", async () => {
    const terminal = new HeadlessTerminal({ cols: 80, rows: 24, allowProposedApi: true })
    await write(terminal, "first line\r\nprompt> ")

    expect(readAgentSnapshot(terminal)).toMatchObject({
      screen: "first line\nprompt>",
      cursorLine: "prompt>",
    })
  })

  it("omits visual hints for regular terminal output", async () => {
    const terminal = new HeadlessTerminal({ cols: 80, rows: 24, allowProposedApi: true })
    await write(terminal, "\x1b[31;1merror\x1b[0m")

    expect(readAgentSnapshot(terminal).visualHints).toBeUndefined()
  })

  it("extracts visual hints from fullscreen terminal cells", async () => {
    const terminal = new HeadlessTerminal({ cols: 80, rows: 24, allowProposedApi: true })
    await write(terminal, "\x1b[?1049h\x1b[31;1merror\x1b[0m\r\n\x1b[7mselected\x1b[0m")

    expect(readAgentSnapshot(terminal)).toMatchObject({
      screen: "error\nselected",
      isFullscreen: true,
      cursorLine: "selected",
      visualHints: [
        { text: "error", attrs: ["red", "bold"] },
        { text: "selected", attrs: ["inverse"] },
      ],
    })
  })
})
