import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitService } from '../../../../src/main/core/git'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'larify-git-'))
  directories.push(directory)
  return directory
}

describe('GitService', () => {
  it('opens Git through simple-git', async () => {
    const directory = await temporaryDirectory()
    const git = await new GitService().open(directory)

    await git.init()
    await writeFile(join(directory, 'example.txt'), 'example')

    expect((await git.status()).not_added).toEqual(['example.txt'])
  })

  it('falls back to embedded Git when the system binary is unavailable', async () => {
    const directory = await temporaryDirectory()
    const git = await new GitService('larify-missing-git-binary').open(directory)

    await git.init()

    expect(await git.checkIsRepo()).toBe(true)
  })

  it('executes Git with stdin through the selected runtime', async () => {
    const directory = await temporaryDirectory()
    const result = await new GitService().exec(['hash-object', '--stdin'], directory, {
      stdin: Buffer.from('example')
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toMatch(/^[0-9a-f]{40}$/)
  })

  it('returns non-zero exits without treating them as launch failures', async () => {
    const directory = await temporaryDirectory()
    const result = await new GitService().exec(['rev-parse', '--verify', 'missing'], directory)

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('preserves output larger than the Node execFile default buffer', async () => {
    const directory = await temporaryDirectory()
    const service = new GitService()
    await (await service.open(directory)).init()
    const content = Buffer.alloc(2 * 1024 * 1024, 'a')
    const stored = await service.exec(['hash-object', '-w', '--stdin'], directory, {
      stdin: content
    })
    const result = await service.exec(
      ['cat-file', 'blob', stored.stdout.toString().trim()],
      directory
    )

    expect(result.exitCode).toBe(0)
    expect(result.stdout.equals(content)).toBe(true)
  })
})
