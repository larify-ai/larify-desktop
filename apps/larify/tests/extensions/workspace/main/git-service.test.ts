import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { simpleGit } from 'simple-git'
import { GitService } from '../../../../src/extensions/workspace/main/git/git-service'

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

describe('GitService', () => {
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

      const statuses = await new GitService().status(root)

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

      const statuses = await new GitService().status(workspace)

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

      const statuses = await new GitService().status(root)

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

      const statuses = await new GitService().status(workspace)

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

      const statuses = await new GitService('larify-missing-git-binary').status(root)

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

      const original = await new GitService().original(root, file)

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

      await expect(new GitService().original(root, file)).resolves.toBeNull()
    },
    gitTestTimeout
  )

  it(
    'reports an error outside a Git repository',
    async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'larify-no-git-'))
      temporaryDirectories.push(root)

      await expect(new GitService().status(root)).rejects.toThrow()
    },
    gitTestTimeout
  )
})
