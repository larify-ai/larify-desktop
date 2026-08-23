import { describe, expect, it } from "vitest"
import {
  charToKeyInfo,
  namedKeyInfo,
  parseKeyChord,
} from "../../../../src/extensions/browser/main/keymap"

describe("browser keymap", () => {
  it("maps every printable ASCII character", () => {
    for (let codePoint = 32; codePoint <= 126; codePoint++) {
      expect(charToKeyInfo(String.fromCharCode(codePoint))).toBeDefined()
    }
  })

  it("marks exactly the US-layout shifted characters", () => {
    const shifted = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:"<>?')
    for (let codePoint = 32; codePoint <= 126; codePoint++) {
      const ch = String.fromCharCode(codePoint)
      expect(Boolean(charToKeyInfo(ch)?.shift)).toBe(shifted.has(ch))
    }
  })

  it("adds character Shift to plain keys and shortcuts", () => {
    expect(parseKeyChord("A").modifiers).toBe(8)
    expect(parseKeyChord("!").modifiers).toBe(8)
    expect(parseKeyChord("Ctrl+A")).toMatchObject({ modifiers: 2, info: { key: "a" } })
    expect(parseKeyChord("Ctrl+Shift+A")).toMatchObject({
      modifiers: 2 | 8,
      info: { key: "A" },
    })
    expect(parseKeyChord("Ctrl++")).toMatchObject({
      modifiers: 2 | 8,
      info: { key: "+", code: "Equal" },
    })
  })

  it("keeps named-key aliases stable", () => {
    expect(namedKeyInfo("return")).toEqual(namedKeyInfo("enter"))
    expect(namedKeyInfo("esc")).toEqual(namedKeyInfo("escape"))
    expect(namedKeyInfo("up")).toEqual(namedKeyInfo("arrowup"))
    expect(namedKeyInfo("space").key).toBe(" ")
  })
})
