import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UIMessage } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'

const roots: string[] = []
const mocks = vi.hoisted(() => ({ root: '' }))

vi.mock('../../../../src/main/utils/app-paths', () => ({
  sessionAttachmentsPath: (sessionId: string) => join(mocks.root, sessionId)
}))

import { loadAttachments, saveAttachments } from '../../../../src/main/core/attachment/files'
import { SessionStore } from '../../../../src/main/core/session/store'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'larify-attachments-'))
  roots.push(path)
  mocks.root = path
  await mkdir(join(path, 'session'))
  return path
}

function message(url: string, mediaType = 'image/png'): UIMessage {
  return {
    id: 'message',
    role: 'user',
    parts: [{ type: 'file', filename: 'image.png', mediaType, url }]
  }
}

describe('attachments', () => {
  it('saves data URLs and loads image previews', async () => {
    await root()
    const saved = await saveAttachments('session', message('data:image/png;base64,aGVsbG8='))
    const file = saved.parts[0]
    if (file.type !== 'file') return
    expect(await readFile(file.url, 'utf8')).toBe('hello')
    await expect(loadAttachments([saved])).resolves.toMatchObject([
      { parts: [{ type: 'file', url: 'data:image/png;base64,aGVsbG8=' }] }
    ])
  })

  it('survives an attachment and session database round trip', async () => {
    const directory = await root()
    const store = new SessionStore(join(directory, 'sessions.db'))
    store.createSession({ id: 'session', title: 'image', cwd: directory })

    const saved = await saveAttachments('session', message('data:image/png;base64,aGVsbG8='))
    store.saveMessages('session', [saved])
    const stored = store.loadSession('session')?.messages ?? []

    expect(stored[0].parts[0]).toMatchObject({ type: 'file', url: saved.parts[0].url })
    await expect(loadAttachments(stored)).resolves.toMatchObject([
      { parts: [{ type: 'file', url: 'data:image/png;base64,aGVsbG8=' }] }
    ])
    store.dispose()
  })

  it('saves percent-encoded data URLs', async () => {
    await root()
    const saved = await saveAttachments(
      'session',
      message('data:text/plain,hello%20world', 'text/plain')
    )
    const file = saved.parts[0]
    if (file.type !== 'file') return
    expect(await readFile(file.url, 'utf8')).toBe('hello world')
  })

  it('keeps selected files at their existing paths', async () => {
    const directory = await root()
    const source = join(directory, 'source.txt')
    await writeFile(source, 'content')
    const saved = await saveAttachments('session', message(source, 'text/plain'))
    const file = saved.parts[0]
    if (file.type !== 'file') return
    expect(file.url).toBe(source)
    expect(await readFile(file.url, 'utf8')).toBe('content')
  })

  it('keeps directories unchanged', async () => {
    await root()
    const saved = await saveAttachments('session', message('C:/work', 'inode/directory'))
    expect(saved.parts[0]).toMatchObject({ url: 'C:/work' })
  })

  it('keeps non-file message parts unchanged', async () => {
    await root()
    const input: UIMessage = {
      id: 'message',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }]
    }
    await expect(saveAttachments('session', input)).resolves.toEqual(input)
    await expect(loadAttachments([input])).resolves.toEqual([input])
  })

  it('does not reload images that already have usable URLs', async () => {
    await root()
    const inputs = [
      message('data:image/png;base64,aGVsbG8='),
      message('blob:https://example.com/image'),
      message('https://example.com/image.png')
    ]
    await expect(loadAttachments(inputs)).resolves.toEqual(inputs)
  })

  it('keeps missing local images unchanged', async () => {
    await root()
    const input = message('C:/missing/image.png')
    await expect(loadAttachments([input])).resolves.toEqual([input])
  })
})
