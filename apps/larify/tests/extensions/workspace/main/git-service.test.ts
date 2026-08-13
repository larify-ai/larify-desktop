import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { simpleGit } from 'simple-git'
import { GitService as GitRuntime, head, status } from '../../../../src/main/core/git'

const temporaryDirectories: string[] = []
const gitTestTimeout = 15_000

const createRepository = async (): Promise<string> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'larify-git-service-'))
  temporaryDirectories.push(root)
  const git = simpleGit(root)
  await git.init()
  await git.addConfig('user.name', 'Larify Test')
  await git.addConfig('user.email', 'test@larify.local')
  return root
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 })
      )
  )
})

describe('Core Git', () => {
  it(
    'returns deleted and staged file states',
    async () => {
      const root = await createRepository()
      const deleted = path.join(root, 'deleted.txt')
      const staged = path.join(root, 'staged.txt')
      await Promise.all([writeFile(deleted, 'delete me'), writeFile(staged, 'before')])
      const git = simpleGit(root)
      await git.add('.').commit('initial')
      await Promise.all([rm(deleted), writeFile(staged, 'after')])
      await git.add(staged)

      const statuses = await status(root)

      expect(statuses.find((entry) => entry.path === deleted)).toMatchObject({
        index: ' ',
        working_dir: 'D'
      })
      expect(statuses.find((entry) => entry.path === staged)).toMatchObject({
        index: 'M',
        working_dir: ' '
      })
    },
    gitTestTimeout
  )

  it(
    'returns merge conflicts',
    async () => {
      const root = await createRepository()
      const file = path.join(root, 'conflict.txt')
      const git = simpleGit(root)
      await writeFile(file, 'base\n')
      await git.add('.').commit('initial')
      const baseBranch = (await git.branchLocal()).current
      await git.checkoutLocalBranch('conflicting-change')
      await writeFile(file, 'branch\n')
      await git.add('.').commit('branch change')
      await git.checkout(baseBranch)
      await writeFile(file, 'base branch\n')
      await git.add('.').commit('base change')
      await expect(git.merge(['conflicting-change'])).rejects.toThrow()

      const statuses = await status(root)

      expect(statuses.find((entry) => entry.path === file)).toMatchObject({
        index: 'U',
        working_dir: 'U'
      })
    },
    gitTestTimeout
  )

  it(
    'preserves spaces and Unicode in paths',
    async () => {
      const root = await createRepository()
      const file = path.join(root, '中文 file name.txt')
      await writeFile(file, 'content')

      const statuses = await status(root)

      expect(statuses.find((entry) => entry.path === file)).toMatchObject({
        index: '?',
        working_dir: '?'
      })
    },
    gitTestTimeout
  )

  it(
    'returns normalized status paths from the system Git',
    async () => {
      const root = await createRepository()
      const tracked = path.join(root, 'tracked.txt')
      const renamed = path.join(root, 'renamed.txt')
      const untracked = path.join(root, 'untracked.txt')
      await writeFile(tracked, 'before')
      await simpleGit(root).add('.').commit('initial')
      await simpleGit(root).mv(tracked, renamed)
      await writeFile(untracked, 'new')

      const statuses = await status(root)

      expect(statuses.map((status) => status.path)).toEqual(
        expect.arrayContaining([renamed, untracked])
      )
      expect(statuses.every((status) => path.isAbsolute(status.path))).toBe(true)
      expect(statuses.find((status) => status.path === renamed)?.from).toBe(tracked)
    },
    gitTestTimeout
  )

  it(
    'filters changes outside a workspace nested in the repository',
    async () => {
      const root = await createRepository()
      const workspace = path.join(root, 'workspace')
      const sibling = path.join(root, 'sibling')
      await Promise.all([mkdir(workspace), mkdir(sibling)])
      const inside = path.join(workspace, 'inside.txt')
      await Promise.all([
        writeFile(inside, 'inside'),
        writeFile(path.join(sibling, 'outside.txt'), 'outside')
      ])

      const statuses = await status(workspace)

      expect(statuses.map((status) => status.path)).toEqual([inside])
    },
    gitTestTimeout
  )

  it(
    'returns ignored paths for explorer decorations',
    async () => {
      const root = await createRepository()
      const ignoredDirectory = path.join(root, 'generated')
      await writeFile(path.join(root, '.gitignore'), 'generated/\n')
      await mkdir(ignoredDirectory)
      await writeFile(path.join(ignoredDirectory, 'output.txt'), 'ignored')

      const statuses = await status(root)

      expect(statuses.find((status) => status.path === ignoredDirectory)).toMatchObject({
        index: '!',
        working_dir: '!'
      })
    },
    gitTestTimeout
  )

  it(
    'returns ignored paths inside a workspace nested in the repository',
    async () => {
      const root = await createRepository()
      const workspace = path.join(root, 'workspace')
      const ignoredDirectory = path.join(workspace, 'generated')
      await mkdir(workspace)
      await writeFile(path.join(root, '.gitignore'), 'generated/\n')
      await mkdir(ignoredDirectory)
      await writeFile(path.join(ignoredDirectory, 'output.txt'), 'ignored')

      const statuses = await status(workspace)

      expect(statuses.find((status) => status.path === ignoredDirectory)).toMatchObject({
        index: '!',
        working_dir: '!'
      })
    },
    gitTestTimeout
  )

  it(
    'falls back to Dugite when the system Git is unavailable',
    async () => {
      const root = await createRepository()
      const file = path.join(root, 'fallback.txt')
      await writeFile(file, 'fallback')

      const statuses = await status(root, new GitRuntime('larify-missing-git-binary'))

      expect(statuses.map((status) => status.path)).toContain(file)
    },
    gitTestTimeout
  )

  it(
    'returns the committed version used by quick diff',
    async () => {
      const root = await createRepository()
      const file = path.join(root, 'tracked.txt')
      await writeFile(file, 'committed\n')
      await simpleGit(root).add('.').commit('initial')
      await writeFile(file, 'working tree\n')

      const original = await head(root, file)

      expect(new TextDecoder().decode(original!)).toBe('committed\n')
    },
    gitTestTimeout
  )

  it(
    'returns no quick diff baseline for an untracked file',
    async () => {
      const root = await createRepository()
      const file = path.join(root, 'untracked.txt')
      await writeFile(file, 'new\n')

      await expect(head(root, file)).resolves.toBeNull()
    },
    gitTestTimeout
  )

  it(
    'initializes Git when HEAD is requested outside a repository',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'larify-no-git-head-'))
      temporaryDirectories.push(root)
      const file = path.join(root, 'untracked.txt')
      await writeFile(file, 'new\n')

      await expect(head(root, file)).resolves.toBeNull()
      await expect(stat(path.join(root, '.git'))).resolves.toMatchObject({})
    },
    gitTestTimeout
  )

  it(
    'shares repository root resolution between status and HEAD',
    async () => {
      const root = await createRepository()
      const file = path.join(root, 'tracked.txt')
      const git = simpleGit(root)
      await writeFile(file, 'committed\n')
      await git.add('.').commit('initial')
      const checkIsRepo = vi.spyOn(git, 'checkIsRepo')
      const revparse = vi.spyOn(git, 'revparse')
      const runtime = { open: async () => git } as unknown as GitRuntime

      await status(root, runtime)
      await head(root, file, runtime)

      expect(checkIsRepo).toHaveBeenCalledTimes(1)
      expect(revparse).toHaveBeenCalledTimes(1)
    },
    gitTestTimeout
  )

  it(
    'rejects a HEAD file outside the workspace',
    async () => {
      const root = await createRepository()
      const workspace = path.join(root, 'workspace')
      const outside = path.join(root, 'outside.txt')
      await mkdir(workspace)
      await writeFile(outside, 'outside')
      await simpleGit(root).add('.').commit('initial')

      await expect(head(workspace, outside)).rejects.toThrow(
        'Path is outside the workspace repository'
      )
    },
    gitTestTimeout
  )

  it(
    'initializes Git outside a repository',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'larify-no-git-'))
      temporaryDirectories.push(root)

      await expect(status(root)).resolves.toEqual([])
      await expect(stat(path.join(root, '.git'))).resolves.toMatchObject({})
    },
    gitTestTimeout
  )
})
