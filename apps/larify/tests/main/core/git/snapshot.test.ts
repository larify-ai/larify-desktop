import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { GitSnapshotService } from '../../../../src/main/core/git/snapshot'

const execFileAsync = promisify(execFile)
const roots: string[] = []

const withoutPatches = (
  files: NonNullable<Awaited<ReturnType<GitSnapshotService['compare']>>>['files'] | undefined
): Array<{ additions: number; binary: boolean; deletions: number; path: string }> | undefined =>
  files?.map(({ additions, binary, deletions, path }) => ({ additions, binary, deletions, path }))

async function createRepository(): Promise<{ repository: string; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'larify-snapshot-'))
  roots.push(root)
  const repository = join(root, 'repository')
  await mkdir(repository)
  await execFileAsync('git', ['init'], { cwd: repository })
  return { repository, root }
}

async function commit(
  repository: string,
  files: Record<string, string | Uint8Array>
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(repository, path)
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content)
  }
  await execFileAsync('git', ['add', '.'], { cwd: repository })
  await execFileAsync(
    'git',
    [
      '-c',
      'user.name=Larify Test',
      '-c',
      'user.email=test@larify.local',
      'commit',
      '-m',
      'initial'
    ],
    { cwd: repository }
  )
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('GitSnapshotService', () => {
  it('captures added, modified, and deleted files without including pre-existing changes', async () => {
    const { repository, root } = await createRepository()
    await commit(repository, {
      'deleted.txt': 'delete me\n',
      'deleted.bin': Buffer.from([0, 1, 2]),
      'existing.txt': 'committed\n',
      'tracked.bin': Buffer.from([0, 1, 2]),
      '.gitignore': 'ignored.txt\n'
    })

    // This change predates the run, so it is present in both snapshot trees.
    await writeFile(join(repository, 'existing.txt'), 'user change\n')
    await execFileAsync('git', ['add', 'existing.txt'], { cwd: repository })
    const indexBefore = (await execFileAsync('git', ['diff', '--cached'], { cwd: repository }))
      .stdout

    const service = new GitSnapshotService(join(root, 'snapshots'))
    const start = await service.start(repository)
    await writeFile(join(repository, 'added.txt'), 'one\ntwo\n')
    await mkdir(join(repository, '带 空格目录'))
    await writeFile(join(repository, '带 空格目录', '文件.txt'), 'content\n')
    await writeFile(join(repository, 'image.bin'), Buffer.from([0, 1, 2, 3]))
    await writeFile(join(repository, '中文文件.txt'), 'content\n')
    await writeFile(join(repository, 'existing.txt'), 'agent change\n')
    await writeFile(join(repository, 'tracked.bin'), Buffer.from([0, 3, 4]))
    await rm(join(repository, 'deleted.bin'))
    await rm(join(repository, 'deleted.txt'))
    await writeFile(join(repository, 'ignored.txt'), 'ignored\n')
    await writeFile(join(repository, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1))

    const result = await service.compare(start)

    expect(withoutPatches(result?.files)).toEqual([
      { additions: 2, binary: false, deletions: 0, path: 'added.txt' },
      { additions: 0, binary: true, deletions: 0, path: 'deleted.bin' },
      { additions: 0, binary: false, deletions: 1, path: 'deleted.txt' },
      { additions: 1, binary: false, deletions: 1, path: 'existing.txt' },
      { additions: 0, binary: true, deletions: 0, path: 'image.bin' },
      { additions: 0, binary: true, deletions: 0, path: 'tracked.bin' },
      { additions: 1, binary: false, deletions: 0, path: '中文文件.txt' },
      { additions: 1, binary: false, deletions: 0, path: '带 空格目录/文件.txt' }
    ])
    expect(result?.files.filter((file) => file.binary).every((file) => file.patch === '')).toBe(
      true
    )
    expect(
      result?.files.filter((file) => !file.binary).every((file) => file.patch.length > 0)
    ).toBe(true)
    expect(result?.files.find((file) => file.path === 'existing.txt')?.patch).toContain(
      '+agent change'
    )
    expect(result).not.toHaveProperty('before')
    expect(result).not.toHaveProperty('after')
    expect(result).not.toHaveProperty('additions')
    expect(result).not.toHaveProperty('deletions')
    expect(result).not.toHaveProperty('repositoryRoot')
    expect(result).not.toHaveProperty('scope')
    expect((await execFileAsync('git', ['diff', '--cached'], { cwd: repository })).stdout).toBe(
      indexBefore
    )
  }, 30_000)

  it('uses the whole Git worktree even when started from a subdirectory', async () => {
    const { repository, root } = await createRepository()
    await commit(repository, {
      'app/inside.txt': 'before\n',
      'outside.txt': 'before\n'
    })
    const service = new GitSnapshotService(join(root, 'snapshots'))
    const start = await service.start(join(repository, 'app'))

    await writeFile(join(repository, 'app/inside.txt'), 'after\n')
    await writeFile(join(repository, 'outside.txt'), 'after\n')

    const result = await service.compare(start)
    expect(result?.root).toBe(repository)
    expect(withoutPatches(result?.files)).toEqual([
      { additions: 1, binary: false, deletions: 1, path: 'app/inside.txt' },
      { additions: 1, binary: false, deletions: 1, path: 'outside.txt' }
    ])
  }, 30_000)

  it('does not report a file that becomes ignored during the run', async () => {
    const { repository, root } = await createRepository()
    await commit(repository, {
      '.gitignore': '',
      'generated.txt': 'before\n'
    })
    const service = new GitSnapshotService(join(root, 'snapshots'))
    const start = await service.start(repository)

    await writeFile(join(repository, '.gitignore'), 'generated.txt\n')
    await writeFile(join(repository, 'generated.txt'), 'after\n')

    expect((await service.compare(start))?.files.map((file) => file.path)).toEqual(['.gitignore'])
  }, 30_000)

  it('captures changes outside a Git repository without creating .git in the workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'larify-no-git-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    await mkdir(workspace)
    await writeFile(join(workspace, 'existing.txt'), 'before\n')
    await writeFile(join(workspace, '.gitignore'), 'ignored.txt\n')
    const service = new GitSnapshotService(join(root, 'snapshots'))
    const start = await service.start(workspace)

    await writeFile(join(workspace, 'existing.txt'), 'after\n')
    await writeFile(join(workspace, 'added.txt'), 'new\n')
    await writeFile(join(workspace, 'ignored.txt'), 'ignored\n')

    expect(withoutPatches((await service.compare(start))?.files)).toEqual([
      { additions: 1, binary: false, deletions: 0, path: 'added.txt' },
      { additions: 1, binary: false, deletions: 1, path: 'existing.txt' }
    ])
    await expect(stat(join(workspace, '.git'))).rejects.toThrow()
  }, 30_000)

  it('compares the same baseline repeatedly as files change', async () => {
    const { repository, root } = await createRepository()
    await commit(repository, { 'file.txt': 'before\n' })
    const service = new GitSnapshotService(join(root, 'snapshots'))
    const start = await service.start(repository)

    await writeFile(join(repository, 'file.txt'), 'first\n')
    expect(withoutPatches((await service.compare(start))?.files)).toEqual([
      { additions: 1, binary: false, deletions: 1, path: 'file.txt' }
    ])

    await writeFile(join(repository, 'file.txt'), 'first\nsecond\n')
    expect(withoutPatches((await service.compare(start))?.files)).toEqual([
      { additions: 2, binary: false, deletions: 1, path: 'file.txt' }
    ])
  }, 30_000)
})
