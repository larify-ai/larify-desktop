import { existsSync } from "node:fs"
import { isAbsolute } from "node:path"
import { pathToFileURL } from "node:url"
import { parse } from "tldts"

const unquote = (text: string): string => {
  if (text.length < 2) return text
  const first = text[0]
  if ((first === '"' || first === "'") && text.at(-1) === first) return text.slice(1, -1)
  return text
}

export function normalizeUrl(input: string): string | null {
  const text = unquote(input.trim())
  if (!text) return null
  if (text.includes("://")) {
    try {
      const protocol = new URL(text).protocol
      if (protocol !== "http:" && protocol !== "https:" && protocol !== "file:") return null
      return text
    } catch {
      return null
    }
  }
  if (isAbsolute(text) && existsSync(text)) return pathToFileURL(text).href
  const { isIp, domain, hostname } = parse(text)
  if (domain) return `https://${text}`
  if (isIp || hostname === "localhost") return `http://${text}`
  return null
}

export function resolveAddress(input: string): string | null {
  const text = unquote(input.trim())
  if (!text) return null
  const url = normalizeUrl(input)
  if (url) return url
  const search = new URL("https://www.bing.com/search")
  search.searchParams.set("q", text)
  return search.href
}
