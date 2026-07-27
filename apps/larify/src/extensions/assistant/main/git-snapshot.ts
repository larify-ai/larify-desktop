/**
 * Git tree snapshots adapted from OpenCode's snapshot design (MIT).
 * The index and objects live outside the user's repository, so capturing a
 * snapshot never stages files or mutates the repository's own Git state.
 */
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { exec } from 'dugite'
import { formatPatch, parsePatch } from 'diff'
import { ensureLarifyPath } from '../../../main/utils/app-paths'

interface GitSnapshotSummary {
  additions: number
  deletions: number
  path: string
}

export interface GitSnapshotFile extends GitSnapshotSummary {
  patch: string
}

export interface GitSnapshotPartData {
  files: GitSnapshotFile[]
}

interface SnapshotStart {
  gitDir: string
  repositoryBacked: boolean
  repositoryRoot: string
  tree: string
}

const SNAPSHOT_CONFIG = [
  ['core.autocrlf', 'false'],
  ['core.fsmonitor', 'false'],
  ['core.longpaths', 'true'],
  ['core.symlinks', 'true']
] as const

async function git(
  args: string[],
  options: { cwd: string; env?: Record<string, string | undefined>; stdin?: Buffer }
): Promise<string> {
  const result = await exec(args, options.cwd, {
    env: options.env,
    stdin: options.stdin
  })
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || `git exited with ${result.exitCode}`)
  }
  return result.stdout
}

const encodeLiteralPaths = (paths: string[]): Buffer =>
  Buffer.from(`${paths.map((path) => `:(top,literal)${path}`).join('\0')}\0`)

function snapshotEnvironment(gitDir: string, repositoryRoot: string): NodeJS.ProcessEnv {
  return {
    GIT_DIR: gitDir,
    GIT_WORK_TREE: repositoryRoot,
    GIT_OPTIONAL_LOCKS: '0'
  }
}

function parseNumstat(output: string): GitSnapshotSummary[] {
  return output
    .split('\0')
    .filter(Boolean)
    .flatMap((record) => {
      const firstTab = record.indexOf('\t')
      const secondTab = record.indexOf('\t', firstTab + 1)
      if (firstTab < 0 || secondTab < 0) return []
      const added = record.slice(0, firstTab)
      const deleted = record.slice(firstTab + 1, secondTab)
      const path = record.slice(secondTab + 1)
      if (!path) return []
      return [
        {
          additions: added === '-' ? 0 : Number.parseInt(added, 10) || 0,
          deletions: deleted === '-' ? 0 : Number.parseInt(deleted, 10) || 0,
          path
        }
      ]
    })
}

export class GitSnapshotService {
  private locks = new Map<string, Promise<unknown>>()

  constructor(private readonly storageRoot = ensureLarifyPath('snapshots')) {}

  async start(cwd: string): Promise<SnapshotStart | null> {
    try {
      const root = await exec(['rev-parse', '--show-toplevel'], cwd)
      const repositoryBacked = root.exitCode === 0 && root.stdout.trim().length > 0
      const repositoryRoot = repositoryBacked ? root.stdout.trim() : resolve(cwd)
      const key = createHash('sha256').update(resolve(repositoryRoot)).digest('hex')
      const gitDir = join(this.storageRoot, key)
      return await this.lock(gitDir, async () => {
        await this.initialize(gitDir, repositoryRoot, repositoryBacked)
        const tree = await this.capture(gitDir, repositoryRoot, repositoryBacked)
        return { gitDir, repositoryBacked, repositoryRoot, tree }
      })
    } catch (error) {
      console.warn('[git snapshot start]', error)
      return null
    }
  }

  async finish(start: SnapshotStart | null): Promise<GitSnapshotPartData | null> {
    if (!start) return null
    try {
      return await this.lock(start.gitDir, async () => {
        const after = await this.capture(
          start.gitDir,
          start.repositoryRoot,
          start.repositoryBacked
        )
        if (after === start.tree) return null
        const output = await git(
          [
            '-c',
            'core.quotepath=false',
            'diff',
            '--numstat',
            '-z',
            '--no-renames',
            start.tree,
            after
          ],
          {
            cwd: start.repositoryRoot,
            env: snapshotEnvironment(start.gitDir, start.repositoryRoot)
          }
        )
        const changed = parseNumstat(output)
        const ignored = await this.ignored(
          changed.map((file) => file.path),
          start.repositoryRoot,
          start.repositoryBacked ? undefined : start.gitDir
        )
        const summaries = changed.filter((file) => !ignored.has(file.path))
        if (summaries.length === 0) return null
        const patchOutput = await git(
          [
            '-c',
            'core.quotepath=false',
            'diff',
            '--patch',
            '--no-ext-diff',
            '--no-renames',
            '--no-prefix',
            '--unified=3',
            start.tree,
            after
          ],
          {
            cwd: start.repositoryRoot,
            env: snapshotEnvironment(start.gitDir, start.repositoryRoot)
          }
        )
        const patches = new Map(
          parsePatch(patchOutput).flatMap((patch) => {
            const path = patch.newFileName === '/dev/null' ? patch.oldFileName : patch.newFileName
            return path ? [[path, formatPatch(patch)] as const] : []
          })
        )
        const files = summaries.map((file) => ({
          ...file,
          patch: patches.get(file.path) ?? ''
        }))
        return { files }
      })
    } catch (error) {
      console.warn('[git snapshot finish]', error)
      return null
    }
  }

  private async initialize(
    gitDir: string,
    repositoryRoot: string,
    repositoryBacked: boolean
  ): Promise<void> {
    await mkdir(gitDir, { recursive: true })
    const head = resolve(gitDir, 'HEAD')
    try {
      await stat(head)
      return
    } catch {
      const env = snapshotEnvironment(gitDir, repositoryRoot)
      await git(['init'], { cwd: repositoryRoot, env })
      for (const [key, value] of SNAPSHOT_CONFIG) {
        await git(['config', key, value], { cwd: repositoryRoot, env })
      }
      if (repositoryBacked) await this.seed(gitDir, repositoryRoot)
    }
  }

  private async seed(gitDir: string, repositoryRoot: string): Promise<void> {
    const commonDir = (
      await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], {
        cwd: repositoryRoot
      })
    ).trim()
    const sourceObjects = join(commonDir, 'objects')
    const alternatesFile = join(sourceObjects, 'info', 'alternates')
    const alternates = [sourceObjects]
    try {
      alternates.push(...(await readFile(alternatesFile, 'utf8')).split(/\r?\n/).filter(Boolean))
    } catch {
      // Most repositories do not have chained alternates.
    }
    const existingAlternates: string[] = []
    for (const candidate of alternates) {
      const absolutePath = resolve(sourceObjects, candidate)
      try {
        await stat(absolutePath)
        existingAlternates.push(absolutePath)
      } catch {
        // Ignore stale alternates inherited from the source repository.
      }
    }
    await mkdir(join(gitDir, 'objects', 'info'), { recursive: true })
    await writeFile(
      join(gitDir, 'objects', 'info', 'alternates'),
      `${existingAlternates.join('\n')}\n`
    )

    const sourceIndex = (
      await git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
        cwd: repositoryRoot
      })
    ).trim()
    try {
      await copyFile(sourceIndex, join(gitDir, 'index'))
    } catch {
      // Empty repositories may not have an index yet.
    }
  }

  private async capture(
    gitDir: string,
    repositoryRoot: string,
    repositoryBacked: boolean
  ): Promise<string> {
    const env = snapshotEnvironment(gitDir, repositoryRoot)
    const tracked = (
      await git(['-c', 'core.quotepath=false', 'diff-files', '--name-only', '-z'], {
        cwd: repositoryRoot,
        env
      })
    )
      .split('\0')
      .filter(Boolean)
    const untracked = (
      await git(['ls-files', '--full-name', '--others', '--exclude-standard', '-z'], {
        cwd: repositoryRoot,
        env
      })
    )
      .split('\0')
      .filter(Boolean)
    const smallUntracked = (
      await Promise.all(
        untracked.map(async (path) => {
          try {
            return (await stat(resolve(repositoryRoot, path))).size <= 2 * 1024 * 1024
              ? path
              : undefined
          } catch {
            // A file can disappear between discovery and capture.
            return undefined
          }
        })
      )
    ).filter((path): path is string => path !== undefined)
    const paths = [...new Set([...tracked, ...smallUntracked])]
    const ignored = await this.ignored(
      paths,
      repositoryRoot,
      repositoryBacked ? undefined : gitDir
    )
    if (ignored.size > 0) {
      await git(
        [
          'rm',
          '--cached',
          '-f',
          '--ignore-unmatch',
          '--pathspec-from-file=-',
          '--pathspec-file-nul'
        ],
        {
          cwd: repositoryRoot,
          env,
          stdin: encodeLiteralPaths([...ignored])
        }
      )
    }
    const allowed = paths.filter((path) => !ignored.has(path))
    if (allowed.length > 0) {
      await git(['add', '--all', '--sparse', '--pathspec-from-file=-', '--pathspec-file-nul'], {
        cwd: repositoryRoot,
        env,
        stdin: encodeLiteralPaths(allowed)
      })
    }
    return (await git(['write-tree'], { cwd: repositoryRoot, env })).trim()
  }

  private async ignored(
    paths: string[],
    repositoryRoot: string,
    gitDir?: string
  ): Promise<Set<string>> {
    if (paths.length === 0) return new Set()
    const protectedPaths = paths.map((path) => (path.startsWith(':') ? `./${path}` : path))
    const result = await exec(['check-ignore', '--no-index', '--stdin', '-z'], repositoryRoot, {
      env: gitDir ? snapshotEnvironment(gitDir, repositoryRoot) : undefined,
      stdin: Buffer.from(`${protectedPaths.join('\0')}\0`)
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || `git check-ignore exited with ${result.exitCode}`)
    }
    return new Set(
      result.stdout
        .split('\0')
        .filter(Boolean)
        .map((path) => (path.startsWith('./:') ? path.slice(2) : path))
    )
  }

  private async lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(task)
    this.locks.set(key, current)
    try {
      return await current
    } finally {
      if (this.locks.get(key) === current) this.locks.delete(key)
    }
  }
}
