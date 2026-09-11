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
    await truncate(source, 32 * 1024 * 1024 + 1)
    await expect(readImage(source, mocks.attachments)).rejects.toThrow('exceeds the 32 MiB limit')
  })
})
