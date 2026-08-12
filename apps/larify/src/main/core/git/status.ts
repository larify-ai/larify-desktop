import path from 'node:path'
import type { FileStatusResult } from 'simple-git'
import { gitService, type GitService } from './core'
import { isInside, resolveRepositoryRoot } from './repository'

export async function status(
  workspaceRoot: string,
  runtime: GitService = gitService
): Promise<FileStatusResult[]> {
  const git = await runtime.open(workspaceRoot)
  const repositoryRoot = await resolveRepositoryRoot(workspaceRoot, git)
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
    .map((ignoredPath) => ({ path: ignoredPath, index: '!', working_dir: '!' }))

  return [...files, ...ignored]
    .map((file) => ({
      ...file,
      path: path.resolve(repositoryRoot, file.path),
      from: file.from ? path.resolve(repositoryRoot, file.from) : undefined
    }))
    .filter((file) => isInside(workspaceRoot, file.path))
}
