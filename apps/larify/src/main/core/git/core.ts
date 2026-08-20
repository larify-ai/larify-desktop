import { vulnerabilityCheck } from '@simple-git/argv-parser'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setupEnvironment } from 'dugite'
import { simpleGit, type SimpleGit, type SimpleGitOptions } from 'simple-git'

interface GitRuntime {
  binary: string
  env?: Record<string, string | undefined>
  options: Pick<SimpleGitOptions, 'binary' | 'unsafe'>
}

interface GitExecOptions {
  env?: Record<string, string | undefined>
  stdin?: Buffer
}

export class GitService {
  private runtime: Promise<GitRuntime> | null = null

  constructor(private readonly systemBinary = 'git') {}

  async open(baseDir: string): Promise<SimpleGit> {
    const runtime = await (this.runtime ??= this.resolveRuntime(baseDir))
    const git = simpleGit({ baseDir, maxConcurrentProcesses: 2, ...runtime.options })
    if (runtime.env) git.env(runtime.env)
    return git
  }

  readonly exec = async (
    args: string[],
    cwd: string,
    options: GitExecOptions = {}
  ): Promise<{ exitCode: number; stderr: Buffer; stdout: Buffer }> => {
    const runtime = await (this.runtime ??= this.resolveRuntime(cwd))
    return await new Promise((resolve, reject) => {
      const child = execFile(
        runtime.binary,
        args,
        {
          cwd,
          encoding: 'buffer',
          env: { ...process.env, ...runtime.env, ...options.env },
          maxBuffer: Infinity
        },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== 'number') {
            reject(error)
            return
          }
          resolve({
            exitCode: typeof error?.code === 'number' ? error.code : 0,
            stderr,
            stdout
          })
        }
      )
      child.stdin?.end(options.stdin)
    })
  }

  private async resolveRuntime(baseDir: string): Promise<GitRuntime> {
    try {
      await simpleGit({ baseDir, binary: this.systemBinary }).version()
      return { binary: this.systemBinary, options: { binary: this.systemBinary } }
    } catch {
      const { env, gitLocation } = setupEnvironment({})
      if (!existsSync(gitLocation)) {
        throw new Error('Git is unavailable: system and embedded Git were not found')
      }
      const unsafe = Object.fromEntries(
        vulnerabilityCheck([], env).map(({ category }) => [category, true])
      ) as NonNullable<SimpleGitOptions['unsafe']>
      unsafe.allowUnsafeCustomBinary = true
      return { binary: gitLocation, env, options: { binary: gitLocation, unsafe } }
    }
  }
}

export const gitService = new GitService()
