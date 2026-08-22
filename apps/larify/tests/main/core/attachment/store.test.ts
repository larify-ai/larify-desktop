import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  sessionAttachmentsPath: (sessionId: string) => join(mocks.root, sessionId)
}))

import { saveAttachmentBytes } from '../../../../src/main/core/attachment/store'

beforeEach(async () => {
  mocks.root = await mkdtemp(join(tmpdir(), 'larify-attachment-store-'))
  roots.push(mocks.root)
  await mkdir(join(mocks.root, 'session'))
})

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('attachment store', () => {
  it('stores bytes by content', async () => {
    const data = Buffer.from('image')
    const path = await saveAttachmentBytes('session', data)

    expect(basename(path)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    await expect(readFile(path)).resolves.toEqual(data)
  })

  it('deduplicates identical content', async () => {
    const data = Buffer.from('same image')
    const first = await saveAttachmentBytes('session', data)
    const second = await saveAttachmentBytes('session', data)

    expect(second).toBe(first)
    await expect(readdir(join(mocks.root, 'session'))).resolves.toEqual([basename(first)])
  })

  it('repairs a corrupted content-addressed attachment', async () => {
    const data = Buffer.from('original image')
    const path = await saveAttachmentBytes('session', data)
    await writeFile(path, 'corrupted')

    const repaired = await saveAttachmentBytes('session', data)

    expect(repaired).toBe(path)
    await expect(readFile(repaired)).resolves.toEqual(data)
  })

  it('publishes concurrent writes atomically', async () => {
    const data = Buffer.alloc(64 * 1024, 7)
    const paths = await Promise.all(
      Array.from({ length: 4 }, () => saveAttachmentBytes('session', data))
    )

    expect(new Set(paths).size).toBe(1)
    await expect(readFile(paths[0])).resolves.toEqual(data)
    await expect(readdir(join(mocks.root, 'session'))).resolves.toEqual([basename(paths[0])])
  })

  it('keeps different content separate', async () => {
    const first = await saveAttachmentBytes('session', Buffer.from('first'))
    const second = await saveAttachmentBytes('session', Buffer.from('second'))

    expect(first).not.toBe(second)
    expect(basename(first)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(basename(second)).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})
