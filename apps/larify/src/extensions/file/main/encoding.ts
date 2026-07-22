import { analyse } from "chardet"
import iconv from "iconv-lite"

const MIN_CONFIDENCE = 50

function guessEncoding(sample: Buffer): { trusted: string | null; note: string } {
  const [best] = analyse(sample)
  const trusted =
    best && best.confidence >= MIN_CONFIDENCE && iconv.encodingExists(best.name) ? best.name : null
  return { trusted, note: `best guess ${best?.name ?? "none"}, confidence ${best?.confidence ?? 0}` }
}

const notUtf8 = (note: string): Error => new Error(`Not UTF-8; encoding undetermined (${note}).`)

export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer)
  } catch {
    const { trusted, note } = guessEncoding(buffer)
    if (!trusted) throw notUtf8(note)
    return iconv.decode(buffer, trusted)
  }
}

export const decodeLossy = (buffer: Buffer): string =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(buffer)

export function createStreamDecoder(): (chunk: Buffer) => string {
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
  let fallbackDecode: ((chunk: Buffer) => string) | null = null
  let utf8Accepted = false

  return (chunk) => {
    if (fallbackDecode) return fallbackDecode(chunk)
    try {
      const text = utf8.decode(chunk, { stream: true })
      utf8Accepted = true
      return text
    } catch {
      const { trusted, note } = guessEncoding(chunk)
      if (utf8Accepted || !trusted) throw notUtf8(note)
      const decoder = iconv.getDecoder(trusted)
      fallbackDecode = (next) => decoder.write(next)
      return fallbackDecode(chunk)
    }
  }
}
