import { net } from "electron"

const DEFAULT_ICON_TYPE = "image/x-icon"

export const faviconOriginFallback = (pageUrl: string): string | null => {
  try {
    const url = new URL(pageUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return new URL("/favicon.ico", url.origin).toString()
  } catch {
    return null
  }
}

export async function faviconDataUrl(url: string): Promise<string | null> {
  try {
    const response = await net.fetch(url)
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0) return null
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || DEFAULT_ICON_TYPE
    return `data:${contentType};base64,${bytes.toString("base64")}`
  } catch {
    return null
  }
}
