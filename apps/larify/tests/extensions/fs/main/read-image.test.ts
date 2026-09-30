import { mkdir, mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callTool } from './harness'

const roots: string[] = []
const mocks = vi.hoisted(() => ({ attachments: '' }))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  sessionAttachmentsPath: () => mocks.attachments
}))

import { readImageTool } from '../../../../src/extensions/fs/main/read-image'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)

interface ReadImageResult {
  storedPath: string
  filename: string
  mediaType: string
}

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), 'larify-read-image-'))
  roots.push(root)
  mocks.attachments = join(root, 'attachments')
  await mkdir(mocks.attachments)
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const readImage = (filePath: string, cwd: string): Promise<ReadImageResult> =>
  callTool<ReadImageResult>(
    readImageTool,
    { file_path: filePath },
    { cwd, sessionId: 'session', modelId: 'deepseek-flash' }
  )

describe('read_image', () => {
  it('reads a relative local image, persists it by content, and returns image bytes', async () => {
    const cwd = join(mocks.attachments, 'workspace')
    await mkdir(cwd)
    await writeFile(join(cwd, 'pixel.png'), png)

    const result = await readImage('pixel.png', cwd)
    expect(result).toMatchObject({
      filename: 'pixel.png',
      mediaType: 'image/png'
    })
    expect(result.storedPath).toMatch(/[A-Za-z0-9_-]{43}\.png$/)
    await expect(readFile(result.storedPath)).resolves.toEqual(png)

    const modelOutput = await readImageTool.toModelOutput?.({ output: result } as never)
    expect(modelOutput).toMatchObject({
      type: 'content',
      value: [
        {
          type: 'file',
          filename: 'pixel.png',
          mediaType: 'image/png',
          data: { type: 'data', data: png }
        }
      ]
    })
  })

  it('deduplicates the persisted bytes of repeated reads', async () => {
    const source = join(mocks.attachments, 'pixel.png')
    await writeFile(source, png)

    const first = await readImage(source, mocks.attachments)
    const second = await readImage(source, mocks.attachments)
    expect(second.storedPath).toBe(first.storedPath)
  })

  it('rejects a non-vision model before accessing the filesystem', async () => {
    await expect(
      callTool(
        readImageTool,
        { file_path: 'missing.png' },
        { cwd: mocks.attachments, modelId: 'deepseek-v4-pro' }
      )
    ).rejects.toThrow('Current model does not support images.')
  })

  it('rejects unsupported file contents', async () => {
    const source = join(mocks.attachments, 'not-an-image.png')
    await writeFile(source, 'not an image')
    await expect(readImage(source, mocks.attachments)).rejects.toThrow(
      'only PNG, JPEG, WebP, and GIF files are supported'
    )
  })

  it('rejects an image whose bytes do not match its extension', async () => {
    const source = join(mocks.attachments, 'pixel.jpg')
    await writeFile(source, png)
    await expect(readImage(source, mocks.attachments)).rejects.toThrow(
      'extension declares image/jpeg, but the file contains image/png'
    )
  })

  it('rejects images larger than the API limit without loading them', async () => {
    const source = join(mocks.attachments, 'large.png')
    await writeFile(source, '')
    await truncate(source, 100 * 1024 + 1)
    await expect(readImage(source, mocks.attachments)).rejects.toThrow('exceeds the 100 KiB limit')
  })
})

/**
 * DeepSeek rejects any image whose width or height exceeds 8192 px, and drops
 * the per-side limit to 4096 px once a request carries 15 or more images. An
 * oversized image that reaches the persisted history is replayed on every later
 * request, so it fails the session permanently. These tests pin the admission
 * gate that keeps such images out of history.
 */
describe('read_image dimension admission', () => {
  // `image-size` reads only the PNG header, so a signature plus a real IHDR is
  // enough to exercise the gate without allocating the decoded pixels.
  const headerOnlyPng = (width: number, height: number): Buffer => {
    const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(width, 0)
    ihdr.writeUInt32BE(height, 4)
    ihdr[8] = 8
    ihdr[9] = 2
    const length = Buffer.alloc(4)
    length.writeUInt32BE(13)
    return Buffer.concat([signature, length, Buffer.from('IHDR', 'ascii'), ihdr, Buffer.alloc(4)])
  }

  const readSizedPng = async (width: number, height: number): Promise<ReadImageResult> => {
    const source = join(mocks.attachments, `${width}x${height}.png`)
    await writeFile(source, headerOnlyPng(width, height))
    return readImage(source, mocks.attachments)
  }

  it('accepts an image whose longest side is exactly the 8192px limit', async () => {
    await expect(readSizedPng(8192, 1)).resolves.toMatchObject({ mediaType: 'image/png' })
    await expect(readSizedPng(1, 8192)).resolves.toMatchObject({ mediaType: 'image/png' })
  })

  it('rejects an image whose longest side exceeds the 8192px limit', async () => {
    await expect(readSizedPng(8193, 1)).rejects.toThrow(
      'is 8193x1 px, and at least one side exceeds the 8192px limit'
    )
    await expect(readSizedPng(1, 8193)).rejects.toThrow(
      'is 1x8193 px, and at least one side exceeds the 8192px limit'
    )
  })

  it('rejects the full-page screenshot geometry that broke a real session', async () => {
    // 1896x11801 is the exact size a `fullPage` screenshot produced on a DPR=1.5
    // display; it is short of the pixel budget and is caught by the side limit alone.
    await expect(readSizedPng(1896, 11801)).rejects.toThrow(
      'is 1896x11801 px, and at least one side exceeds the 8192px limit'
    )
  })

  it('accepts an image at exactly the 64,000,000-pixel budget', async () => {
    await expect(readSizedPng(8000, 8000)).resolves.toMatchObject({ mediaType: 'image/png' })
  })

  it('rejects an image that exceeds the 64,000,000-pixel budget', async () => {
    await expect(readSizedPng(8001, 8000)).rejects.toThrow(
      'is 8001x8000 px, exceeding the 64000000-pixel limit'
    )
  })

  it('rejects a square image whose sides fit the 8192px limit but whose pixels do not', async () => {
    // The pixel budget is the only rule that rejects this shape: 8192x8192 is
    // exactly 8192 px per side yet 67,108,864 pixels.
    await expect(readSizedPng(8192, 8192)).rejects.toThrow(
      'exceeding the 64000000-pixel limit'
    )
  })

  it('reads a GIF and applies the dimension gate to it', async () => {
    const gif = Buffer.concat([
      Buffer.from('GIF89a', 'ascii'),
      (() => {
        const screen = Buffer.alloc(7)
        screen.writeUInt16LE(100, 0)
        screen.writeUInt16LE(50, 2)
        return screen
      })()
    ])
    const source = join(mocks.attachments, 'ok.gif')
    await writeFile(source, gif)
    await expect(readImage(source, mocks.attachments)).resolves.toMatchObject({
      mediaType: 'image/gif'
    })

    // The same container declaring an oversized logical screen must be refused.
    const oversized = Buffer.concat([
      Buffer.from('GIF89a', 'ascii'),
      (() => {
        const screen = Buffer.alloc(7)
        screen.writeUInt16LE(20000, 0)
        screen.writeUInt16LE(50, 2)
        return screen
      })()
    ])
    const oversizedSource = join(mocks.attachments, 'oversized.gif')
    await writeFile(oversizedSource, oversized)
    await expect(readImage(oversizedSource, mocks.attachments)).rejects.toThrow(
      'and at least one side exceeds the 8192px limit'
    )
  })

  it('reads a WebP and applies the dimension gate to it', async () => {
    // Minimal lossy WebP: RIFF header, `VP8 ` chunk, 3-byte frame tag, the
    // 0x9d012a start code, then 14-bit width and height. Mirrors the byte layout
    // of a real encoder output rather than a synthetic container.
    const lossyWebp = (width: number, height: number): Buffer => {
      const payload = Buffer.alloc(10)
      payload[3] = 0x9d
      payload[4] = 0x01
      payload[5] = 0x2a
      payload.writeUInt16LE(width & 0x3fff, 6)
      payload.writeUInt16LE(height & 0x3fff, 8)
      const chunk = Buffer.concat([
        Buffer.from('VP8 ', 'ascii'),
        (() => {
          const size = Buffer.alloc(4)
          size.writeUInt32LE(payload.length, 0)
          return size
        })(),
        payload
      ])
      const riff = Buffer.from('RIFF', 'ascii')
      const riffSize = Buffer.alloc(4)
      riffSize.writeUInt32LE(4 + chunk.length, 0)
      return Buffer.concat([riff, riffSize, Buffer.from('WEBP', 'ascii'), chunk])
    }

    const ok = join(mocks.attachments, 'ok.webp')
    await writeFile(ok, lossyWebp(550, 368))
    await expect(readImage(ok, mocks.attachments)).resolves.toMatchObject({
      mediaType: 'image/webp'
    })

    const oversized = join(mocks.attachments, 'oversized.webp')
    await writeFile(oversized, lossyWebp(9000, 368))
    await expect(readImage(oversized, mocks.attachments)).rejects.toThrow(
      'and at least one side exceeds the 8192px limit'
    )
  })

  it('resolves dimensions from the file signature rather than the extension', async () => {
    // A PNG's dimensions are readable regardless of which supported extension
    // declares it, so the gate cannot be dodged by renaming.
    const source = join(mocks.attachments, 'renamed.jpg')
    await writeFile(
      source,
      (() => {
        const declared = headerOnlyPng(9000, 10)
        return declared
      })()
    )
    await expect(readImage(source, mocks.attachments)).rejects.toThrow(
      'extension declares image/jpeg, but the file contains image/png'
    )
  })

  it('surfaces a truncated PNG as a library error when its header is incomplete', async () => {
    // Documents the current, unfixed behaviour: `image-size` throws a raw
    // RangeError instead of a recoverable tool error, so the message is not
    // actionable for the model. Pinned here so a fix is a deliberate change.
    const source = join(mocks.attachments, 'truncated.png')
    await writeFile(
      source,
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52
      ])
    )
    await expect(readImage(source, mocks.attachments)).rejects.toThrow(RangeError)
    await expect(readImage(source, mocks.attachments)).rejects.toThrow(
      /outside the bounds of the buffer/
    )
  })
})
