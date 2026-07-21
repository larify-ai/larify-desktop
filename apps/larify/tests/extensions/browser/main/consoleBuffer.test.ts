import { describe, expect, it } from "vitest"
import {
  ConsoleBuffer,
  parseConsoleEvent,
  parseExceptionEvent,
} from "../../../../src/extensions/browser/main/consoleBuffer"

function seed(buffer: ConsoleBuffer, entries: Array<[string, string]>): void {
  for (const [type, text] of entries) buffer.addConsole({ type, text })
}

describe("ConsoleBuffer", () => {
  it("evicts oldest entries past the 1000 cap and counts them as dropped", () => {
    const buffer = new ConsoleBuffer()
    for (let i = 0; i < 1005; i++) buffer.addConsole({ type: "log", text: `m${i}` })

    const { entries, dropped } = buffer.readConsole()

    expect(entries).toHaveLength(1000)
    expect(entries[0].text).toBe("m5")
    expect(entries[999].text).toBe("m1004")
    expect(dropped).toBe(5)
  })

  it("filters by level", () => {
    const buffer = new ConsoleBuffer()
    seed(buffer, [
      ["log", "a"],
      ["error", "b"],
      ["warning", "c"],
      ["error", "d"],
    ])

    expect(buffer.readConsole({ level: "error" }).entries.map((e) => e.text)).toEqual(["b", "d"])
  })

  it("truncates to the last N with limit, and returns none for limit<=0", () => {
    const buffer = new ConsoleBuffer()
    seed(buffer, [
      ["log", "a"],
      ["log", "b"],
      ["log", "c"],
    ])

    expect(buffer.readConsole({ limit: 2 }).entries.map((e) => e.text)).toEqual(["b", "c"])
    expect(buffer.readConsole({ limit: 0 }).entries).toEqual([])
  })

  it("clear without a level empties the buffer and resets dropped", () => {
    const buffer = new ConsoleBuffer()
    for (let i = 0; i < 1002; i++) buffer.addConsole({ type: "log", text: `m${i}` })

    const first = buffer.readConsole({ clear: true })
    expect(first.dropped).toBe(2)

    const second = buffer.readConsole()
    expect(second.entries).toEqual([])
    expect(second.dropped).toBe(0)
  })

  it("clear with a level removes only that level and keeps the rest", () => {
    const buffer = new ConsoleBuffer()
    seed(buffer, [
      ["log", "a"],
      ["error", "b"],
      ["warning", "c"],
      ["error", "d"],
    ])

    const cleared = buffer.readConsole({ level: "error", clear: true })
    expect(cleared.entries.map((e) => e.text)).toEqual(["b", "d"])

    const remaining = buffer.readConsole()
    expect(remaining.entries.map((e) => e.text)).toEqual(["a", "c"])
    expect(remaining.entries.some((e) => e.type === "error")).toBe(false)
  })

  it("readErrors clears independently", () => {
    const buffer = new ConsoleBuffer()
    buffer.addError({ message: "boom" })

    expect(buffer.readErrors({ clear: true }).entries).toHaveLength(1)
    expect(buffer.readErrors().entries).toEqual([])
  })
})

describe("parseConsoleEvent", () => {
  it("formats primitive, undefined, null, object and array args", () => {
    expect(parseConsoleEvent({ type: "log", args: [{ value: "hi" }] }).text).toBe("hi")
    expect(parseConsoleEvent({ args: [{ type: "undefined" }] }).text).toBe("undefined")
    expect(parseConsoleEvent({ args: [{ subtype: "null" }] }).text).toBe("null")
    expect(parseConsoleEvent({ args: [{ value: 42 }] }).text).toBe("42")

    const obj = parseConsoleEvent({
      args: [{ preview: { properties: [{ name: "x", type: "number", value: "1" }] } }],
    }).text
    expect(obj).toBe("{x: 1}")

    const arr = parseConsoleEvent({
      args: [{ subtype: "array", preview: { subtype: "array", properties: [{ name: "0", type: "string", value: "a" }], overflow: true } }],
    }).text
    expect(arr).toBe('["a", ...]')
  })

  it("defaults the type to log and takes the url from the first stack frame", () => {
    const entry = parseConsoleEvent({ args: [{ value: "x" }], stackTrace: { callFrames: [{ url: "http://x/y.js" }] } })
    expect(entry.type).toBe("log")
    expect(entry.url).toBe("http://x/y.js")
  })

  it("formats map/set previews, unserializable values, and the description fallback", () => {
    expect(parseConsoleEvent({ args: [{ preview: { subtype: "map", description: "Map(2)" } }] }).text).toBe(
      "Map(2)",
    )
    expect(parseConsoleEvent({ args: [{ unserializableValue: "Infinity" }] }).text).toBe("Infinity")
    expect(parseConsoleEvent({ args: [{ description: "function foo()" }] }).text).toBe("function foo()")
  })

  it("drops unformattable args from the joined output", () => {
    expect(parseConsoleEvent({ args: [{ value: "keep" }, {}, { value: "tail" }] }).text).toBe("keep tail")
  })
})

describe("parseExceptionEvent", () => {
  it("prefers the exception description and formats the stack", () => {
    const entry = parseExceptionEvent({
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "TypeError: boom" },
        lineNumber: 3,
        columnNumber: 7,
        stackTrace: { callFrames: [{ functionName: "f", url: "http://x/y.js", lineNumber: 3, columnNumber: 7 }] },
      },
    })

    expect(entry.message).toBe("TypeError: boom")
    expect(entry.line).toBe(3)
    expect(entry.stack).toContain("at f (http://x/y.js:3:7)")
  })

  it("falls back to text and the first stack url when no exception description is present", () => {
    const entry = parseExceptionEvent({
      exceptionDetails: {
        text: "Script error",
        stackTrace: { callFrames: [{ functionName: "g", url: "http://a/b.js", lineNumber: 1, columnNumber: 2 }] },
      },
    })

    expect(entry.message).toBe("Script error")
    expect(entry.url).toBe("http://a/b.js")
  })

  it("uses the default message when neither description nor text is present", () => {
    expect(parseExceptionEvent({ exceptionDetails: {} }).message).toBe("Uncaught error")
  })
})
