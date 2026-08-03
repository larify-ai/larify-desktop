import { writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { larifyTempPath } from './app-paths'
import { createUniqueFile } from './unique-path'

export type ToolPayload = { inline: string } | { path: string; bytes: number; preview: string }

const SPILL_THRESHOLD = 30_000
const PREVIEW_CHARS = 1500

export function prepareToolOutput(content: string): ToolPayload {
  const bytes = Buffer.byteLength(content, 'utf8')
  if (bytes <= SPILL_THRESHOLD) return { inline: content }
  const path = createUniqueFile(larifyTempPath('tool-output'))
  writeFileSync(path, content, 'utf8')
  return { path, bytes, preview: content.slice(0, PREVIEW_CHARS) }
}

export async function prepareResponseOutput(response: Response): Promise<ToolPayload> {
  if (!response.body) return { inline: '' }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let inline = ''
  let preview = ''
  let bytes = 0
  let file: Awaited<ReturnType<typeof open>> | undefined
  let path: string | undefined

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      const text = decoder.decode(chunk.value, { stream: true })
      preview = (preview + text).slice(0, PREVIEW_CHARS)
      if (!file && bytes <= SPILL_THRESHOLD) {
        inline += text
        continue
      }
      if (!file) {
        path = createUniqueFile(larifyTempPath('tool-output'))
        file = await open(path, 'w')
        await file.write(inline)
        inline = ''
      }
      await file.write(text)
    }
    const tail = decoder.decode()
    if (file) await file.write(tail)
    else inline += tail
  } finally {
    await file?.close()
  }

  return path ? { path, bytes, preview } : { inline }
}
