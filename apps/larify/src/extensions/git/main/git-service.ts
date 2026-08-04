import { vulnerabilityCheck } from '@simple-git/argv-parser'
import { exec, setupEnvironment } from 'dugite'
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

interface GitRuntime {
  env?: Record<string, string | undefined>
  options: Pick<SimpleGitOptions, 'binary' | 'unsafe'>
}

export class GitService {
  readonly exec = exec
  private runtime: Promise<GitRuntime> | null = null

  constructor(private readonly systemBinary = 'git') {}

  async open(baseDir: string): Promise<SimpleGit> {
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
      return { env, options: { binary: gitLocation, unsafe } }
    }
  }
}
