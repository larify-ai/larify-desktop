import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { normalizeUrl, resolveAddress } from "../../../../src/extensions/browser/main/url"

describe("normalizeUrl", () => {
  it("returns null for empty and non-url search text", () => {
    expect(normalizeUrl("")).toBeNull()
    expect(normalizeUrl("   ")).toBeNull()
    expect(normalizeUrl("hello world")).toBeNull()
    expect(normalizeUrl("example")).toBeNull()
  })

  it("keeps valid explicit urls and rejects invalid explicit urls", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com")
    expect(normalizeUrl("http://example.com")).toBe("http://example.com")
    expect(normalizeUrl("file:///C:/tmp/a.txt")).toBe("file:///C:/tmp/a.txt")
    expect(normalizeUrl("about:blank")).toBeNull()
    expect(normalizeUrl("http://")).toBeNull()
    expect(normalizeUrl("custom://example")).toBeNull()
    expect(normalizeUrl("javascript://alert(1)")).toBeNull()
  })

  it("adds schemes for domains, localhost, and ip addresses", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com")
    expect(normalizeUrl("sub.example.co.uk/path")).toBe("https://sub.example.co.uk/path")
    expect(normalizeUrl("localhost")).toBe("http://localhost")
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeUrl("192.168.1.1")).toBe("http://192.168.1.1")
    expect(normalizeUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000")
  })

  it("removes matching quotes", () => {
    expect(normalizeUrl('"example.com"')).toBe("https://example.com")
    expect(normalizeUrl("'localhost:3000'")).toBe("http://localhost:3000")
    expect(normalizeUrl('"example.com')).toBeNull()
  })

  it("converts existing absolute file paths to file urls", () => {
    const dir = mkdtempSync(join(tmpdir(), "larify-browser-url-"))
    const filePath = join(dir, "index.html")
    writeFileSync(filePath, "<html></html>")

    expect(normalizeUrl(filePath)).toBe(pathToFileURL(filePath).href)
  })
})

describe("resolveAddress", () => {
  it("keeps urls and turns other address-bar input into a search", () => {
    expect(resolveAddress("example.com")).toBe("https://example.com")
    expect(resolveAddress("小红书")).toBe(
      "https://www.bing.com/search?q=%E5%B0%8F%E7%BA%A2%E4%B9%A6"
    )
    expect(resolveAddress("hello world")).toBe("https://www.bing.com/search?q=hello+world")
    expect(resolveAddress("what is https://")).toBe(
      "https://www.bing.com/search?q=what+is+https%3A%2F%2F"
    )
  })

  it("rejects empty input and searches unsupported urls", () => {
    expect(resolveAddress(" ")).toBeNull()
    expect(resolveAddress("http://")).toBe("https://www.bing.com/search?q=http%3A%2F%2F")
    expect(resolveAddress("custom://example")).toBe(
      "https://www.bing.com/search?q=custom%3A%2F%2Fexample"
    )
  })
})
