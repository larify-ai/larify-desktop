import { open } from "node:fs/promises"
import { normalizeLineBreaks } from "../../../main/utils/text"
import { createStreamDecoder } from "./encoding"

const CHUNK_BYTES = 1 << 20

export async function* normalizedChunks(target: string): AsyncGenerator<string> {
  const handle = await open(target, "r")
  try {
    const buffer = Buffer.alloc(CHUNK_BYTES)
    const decode = createStreamDecoder()
    let carry = ""
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_BYTES, null)
      if (bytesRead === 0) break
      let text = carry + decode(buffer.subarray(0, bytesRead))
      carry = ""
      if (text.endsWith("\r")) {
        carry = "\r"
        text = text.slice(0, -1)
      }
      if (text) yield normalizeLineBreaks(text)
    }
    const tail = carry + decode.end()
    if (tail) yield normalizeLineBreaks(tail)
  } finally {
    await handle.close()
  }
}
