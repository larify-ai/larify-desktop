import { describe, expect, it, vi } from "vitest"
import type { WebContents } from "electron"
import {
  dispatchKey,
  insertText,
  keyDown,
  pressKey,
  typeText,
} from "../../../../src/extensions/browser/main/nativeInput"
import { namedKeyInfo } from "../../../../src/extensions/browser/main/keymap"

function contents(host?: { executeJavaScript: ReturnType<typeof vi.fn> }): {
  value: WebContents
  insertText: ReturnType<typeof vi.fn>
  sendInputEvent: ReturnType<typeof vi.fn>
} {
  const nativeInsertText = vi.fn(async () => undefined)
  const sendInputEvent = vi.fn()
  return {
    value: {
      id: 42,
      getType: () => host ? "webview" : "webContentsView",
      debugger: { isAttached: () => false },
      hostWebContents: host
        ? ({ isDestroyed: () => false, executeJavaScript: host.executeJavaScript } as WebContents)
        : null,
      insertText: nativeInsertText,
      sendInputEvent,
    } as unknown as WebContents,
    insertText: nativeInsertText,
    sendInputEvent,
  }
}

describe("native browser input", () => {
  it("routes WebView input through its host element", async () => {
    const executeJavaScript = vi.fn(async () => undefined)
    const target = contents({ executeJavaScript })

    await insertText(target.value, "hello")
    await keyDown(target.value, namedKeyInfo("a"), 2 | 8)

    expect(target.insertText).not.toHaveBeenCalled()
    expect(target.sendInputEvent).not.toHaveBeenCalled()
    expect(executeJavaScript).toHaveBeenCalledTimes(2)
    expect(executeJavaScript.mock.calls[0][0]).toContain('const method = "insertText"')
    expect(executeJavaScript.mock.calls[0][0]).toContain('const argument = "hello"')
    expect(executeJavaScript.mock.calls[0][0]).toContain("return webview.executeJavaScript('void 0')")
    expect(executeJavaScript.mock.calls[1][0]).toContain('const method = "sendInputEvent"')
    expect(executeJavaScript.mock.calls[1][0]).toContain('"modifiers":["control","shift"]')
  })

  it("uses WebContents directly for non-WebView temporary tabs", async () => {
    const target = contents()

    await insertText(target.value, "hello")
    await keyDown(target.value, namedKeyInfo("a"), 0)

    expect(target.insertText).toHaveBeenCalledWith("hello")
    expect(target.sendInputEvent).toHaveBeenCalledWith({
      type: "keyDown",
      keyCode: "a",
      modifiers: [],
    })
    expect(target.insertText).toHaveBeenLastCalledWith("a")
  })

  it("uses CDP for temporary tabs when their debugger is attached", async () => {
    const sendCommand = vi.fn(async () => ({}))
    const target = contents()
    target.value.getType = () => "window"
    target.value.debugger.isAttached = () => true
    target.value.debugger.sendCommand = sendCommand

    await dispatchKey(target.value, namedKeyInfo("a"))

    expect(sendCommand.mock.calls.map(([method]) => method)).toEqual([
      "Input.dispatchKeyEvent",
      "Input.insertText",
      "Input.dispatchKeyEvent",
    ])
    expect(target.sendInputEvent).not.toHaveBeenCalled()
    expect(target.insertText).not.toHaveBeenCalled()
  })

  it("combines key events with text insertion for printable keys", async () => {
    const target = contents()

    await typeText(target.value, "A")

    expect(target.sendInputEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: "keyDown", keyCode: "A", modifiers: ["shift"] },
      { type: "keyUp", keyCode: "A", modifiers: ["shift"] },
    ])
    expect(target.insertText).toHaveBeenCalledWith("A")
  })

  it("keeps WebView key events and text insertion as separate routed operations", async () => {
    const executeJavaScript = vi.fn(async () => undefined)
    const target = contents({ executeJavaScript })

    await typeText(target.value, "a")

    expect(executeJavaScript).toHaveBeenCalledTimes(3)
    expect(executeJavaScript.mock.calls[0][0]).toContain('const method = "sendInputEvent"')
    expect(executeJavaScript.mock.calls[1][0]).toContain('const method = "insertText"')
    expect(executeJavaScript.mock.calls[2][0]).toContain('const method = "sendInputEvent"')
  })

  it("releases a key when text insertion fails after keyDown", async () => {
    const executeJavaScript = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("insert failed"))
      .mockResolvedValueOnce(undefined)
    const target = contents({ executeJavaScript })

    await expect(dispatchKey(target.value, namedKeyInfo("a"))).rejects.toThrow("insert failed")

    expect(executeJavaScript).toHaveBeenCalledTimes(3)
    expect(executeJavaScript.mock.calls[0][0]).toContain('"type":"keyDown"')
    expect(executeJavaScript.mock.calls[2][0]).toContain('"type":"keyUp"')
  })

  it("does not insert text for Control or Meta shortcuts", async () => {
    const target = contents()

    await typeText(target.value, "a", 2)
    await typeText(target.value, "v", 4)

    expect(target.sendInputEvent).toHaveBeenCalledTimes(4)
    expect(target.insertText).not.toHaveBeenCalled()
  })

  it("inserts a newline for Enter but lets Tab move focus natively", async () => {
    const target = contents()

    await typeText(target.value, "\n\t")

    expect(target.insertText).toHaveBeenCalledTimes(1)
    expect(target.insertText).toHaveBeenCalledWith("\n")
  })

  it("types every printable ASCII character with the US-layout Shift state", async () => {
    const target = contents()
    const printable = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("")
    const shifted = new Set('~!@#$%^&*()_+{}|:"<>?ABCDEFGHIJKLMNOPQRSTUVWXYZ')

    await typeText(target.value, printable)

    const keyDownEvents = target.sendInputEvent.mock.calls
      .map(([event]) => event as Electron.KeyboardInputEvent)
      .filter((event) => event.type === "keyDown")
    expect(keyDownEvents).toHaveLength(95)
    for (const event of keyDownEvents) {
      expect(event.modifiers?.includes("shift")).toBe(shifted.has(event.keyCode))
    }
    expect(target.insertText.mock.calls.map(([text]) => text).join("")).toBe(printable)
  })

  it("translates DOM arrow names to Electron key codes", async () => {
    const target = contents()

    await keyDown(target.value, namedKeyInfo("ArrowUp"))
    await keyDown(target.value, namedKeyInfo("ArrowDown"))
    await keyDown(target.value, namedKeyInfo("ArrowLeft"))
    await keyDown(target.value, namedKeyInfo("ArrowRight"))

    expect(target.sendInputEvent.mock.calls.map(([event]) => event.keyCode)).toEqual([
      "Up",
      "Down",
      "Left",
      "Right",
    ])
  })

  it("presses and releases shortcut modifiers around the target key", async () => {
    const target = contents()

    await pressKey(target.value, namedKeyInfo("a"), 2 | 8)

    expect(target.sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
      ["keyDown", "Control"],
      ["keyDown", "Shift"],
      ["keyDown", "a"],
      ["keyUp", "a"],
      ["keyUp", "Shift"],
      ["keyUp", "Control"],
    ])
  })

  it("does not press or release modifiers that are already held", async () => {
    const target = contents()

    await pressKey(target.value, namedKeyInfo("a"), 2, 2)

    expect(target.sendInputEvent.mock.calls.map(([event]) => [event.type, event.keyCode])).toEqual([
      ["keyDown", "a"],
      ["keyUp", "a"],
    ])
  })

  it("only releases shortcut modifiers whose keyDown was attempted", async () => {
    const executeJavaScript = vi
      .fn()
      .mockRejectedValueOnce(new Error("modifier failed"))
      .mockResolvedValueOnce(undefined)
    const target = contents({ executeJavaScript })

    await expect(pressKey(target.value, namedKeyInfo("a"), 2 | 8)).rejects.toThrow(
      "modifier failed",
    )

    expect(executeJavaScript).toHaveBeenCalledTimes(2)
    expect(executeJavaScript.mock.calls[0][0]).toContain('"keyCode":"Control"')
    expect(executeJavaScript.mock.calls[0][0]).toContain('"type":"keyDown"')
    expect(executeJavaScript.mock.calls[1][0]).toContain('"keyCode":"Control"')
    expect(executeJavaScript.mock.calls[1][0]).toContain('"type":"keyUp"')
  })
})
