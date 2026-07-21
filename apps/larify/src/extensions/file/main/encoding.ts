import { detect } from "chardet"
import iconv from "iconv-lite"

export function decodeText(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer)
  } catch {
    const detected = detect(buffer)
    const encoding = detected && iconv.encodingExists(detected) ? detected : "utf8"
    return iconv.decode(buffer, encoding)
  }
}
