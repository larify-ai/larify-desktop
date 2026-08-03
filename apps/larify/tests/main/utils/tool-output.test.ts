import { existsSync, readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { prepareResponseOutput } from '../../../src/main/utils/tool-output'

describe('streamed tool output', () => {
  it('keeps small responses inline', async () => {
    await expect(prepareResponseOutput(new Response('你好'))).resolves.toEqual({ inline: '你好' })
  })

  it('streams large responses to disk', async () => {
    const content = '内容'.repeat(20_000)
    const output = await prepareResponseOutput(new Response(content))
    expect('path' in output).toBe(true)
    if (!('path' in output)) return

    try {
      expect(existsSync(output.path)).toBe(true)
      expect(output.bytes).toBe(Buffer.byteLength(content))
      expect(output.preview).toBe(content.slice(0, 1500))
      expect(readFileSync(output.path, 'utf8')).toBe(content)
    } finally {
      rmSync(output.path, { force: true })
    }
  })
})
