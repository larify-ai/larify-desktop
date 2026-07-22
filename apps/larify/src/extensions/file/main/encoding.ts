import { analyse } from "chardet"
import iconv from "iconv-lite"

const MIN_CONFIDENCE = 50

export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    const [best] = analyse(buffer)
    if (!best || best.confidence < MIN_CONFIDENCE || !iconv.encodingExists(best.name)) {
      throw new Error(
        `Not UTF-8; encoding undetermined (best guess ${best?.name ?? "none"}, confidence ${best?.confidence ?? 0}).`,
      )
    }
    return iconv.decode(buffer, best.name)
  }
}

export const decodeLossy = (buffer: Buffer): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer)
