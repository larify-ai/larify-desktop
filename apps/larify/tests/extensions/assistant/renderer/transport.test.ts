import { describe, expect, it } from "vitest"
import { ipcTransport } from "../../../../src/extensions/assistant/renderer/lib/transport"

describe("assistant transport", () => {
  it("exposes the IPC chat transport", () => {
    expect(typeof ipcTransport.sendMessages).toBe("function")
    expect(typeof ipcTransport.reconnectToStream).toBe("function")
  })
})
