import path from 'node:path'
import { vulnerabilityCheck } from '@simple-git/argv-parser'
import { setupEnvironment } from 'dugite'
import { simpleGit, type FileStatusResult, type SimpleGit, type SimpleGitOptions } from 'simple-git'

interface GitRuntime {
  env?: Record<string, string | undefined>
  options: Pick<SimpleGitOptions, 'binary' | 'unsafe'>
}

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export class GitService {
  private runtime: Promise<GitRuntime> | null = null
  private readonly repositoryRoots = new Map<string, string>()

  constructor(private readonly systemBinary = 'git') {}

  async status(workspaceRoot: string): Promise<FileStatusResult[]> {
    const git = await this.createClient(workspaceRoot)
    const repositoryRoot = await this.resolveRepositoryRoot(git, workspaceRoot)
    const [{ files }, ignoredOutput] = await Promise.all([
      git.status(),
      git.raw([
        'ls-files',
        '--others',
        '--ignored',
        '--exclude-standard',
        '--directory',
        '--full-name',
        '-z'
      ])
    ])
    const ignored: FileStatusResult[] = ignoredOutput
      .split('\0')
      .filter(Boolean)
      .map((ignoredPath) => ({
        path: ignoredPath,
        index: '!',
        working_dir: '!'
      }))
    return [...files, ...ignored]
      .map((file) => ({
        ...file,
        path: path.resolve(repositoryRoot, file.path),
        from: file.from ? path.resolve(repositoryRoot, file.from) : undefined
      }))
      .filter((file) => isInside(workspaceRoot, file.path))
  }

  async original(workspaceRoot: string, file: string): Promise<Uint8Array | null> {
    const git = await this.createClient(workspaceRoot)
    const repositoryRoot = await this.resolveRepositoryRoot(git, workspaceRoot)
    const target = path.resolve(file)
    if (!isInside(workspaceRoot, target) || !isInside(repositoryRoot, target)) {
      throw new Error('Path is outside the workspace repository')
    }

    const relative = path.relative(repositoryRoot, target).split(path.sep).join('/')
    try {
      return new TextEncoder().encode(await git.raw(['show', `HEAD:${relative}`]))
    } catch {
      return null
    }
  }

  private async resolveRepositoryRoot(git: SimpleGit, workspaceRoot: string): Promise<string> {
    const key = path.resolve(workspaceRoot)
    const cached = this.repositoryRoots.get(key)
    if (cached) return cached

    const repositoryRoot = path.resolve(await git.revparse(['--show-toplevel']))
    this.repositoryRoots.set(key, repositoryRoot)
    return repositoryRoot
  }

  private async createClient(baseDir: string): Promise<SimpleGit> {
    const runtime = await (this.runtime ??= this.resolveRuntime(baseDir))
    const git = simpleGit({
      baseDir,
      maxConcurrentProcesses: 2,
      ...runtime.options
    })
    if (runtime.env) git.env(runtime.env)
    return git
  }

  private async resolveRuntime(baseDir: string): Promise<GitRuntime> {
    try {
      await simpleGit({ baseDir, binary: this.systemBinary }).version()
      return { options: { binary: this.systemBinary } }
    } catch {
      const { env, gitLocation } = setupEnvironment({})
      const unsafe = Object.fromEntries(
        vulnerabilityCheck([], env).map(({ category }) => [category, true])
      ) as NonNullable<SimpleGitOptions['unsafe']>
      return {
        env,
        options: {
          binary: gitLocation,
          unsafe
        }
      }
    }
  }
}
