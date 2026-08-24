import path from 'node:path'
import type { FileStatusResult } from 'simple-git'
import { gitService, type GitService } from './core'
import { isPathInside } from '../../utils/path'
import { resolveRepositoryRoot } from './repository'

export async function status(
  workspaceRoot: string,
  runtime: GitService = gitService,
  includeIgnored = true
): Promise<FileStatusResult[]> {
  const git = await runtime.open(workspaceRoot)
  git.env('GIT_OPTIONAL_LOCKS', '0')
  const repositoryRoot = await resolveRepositoryRoot(workspaceRoot, git)
  const [{ files }, ignoredOutput] = await Promise.all([
    git.status(),
    includeIgnored
      ? git.raw([
          'ls-files',
          '--others',
          '--ignored',
          '--exclude-standard',
          '--directory',
          '--full-name',
          '-z'
        ])
      : Promise.resolve('')
  ])
  const ignored: FileStatusResult[] = ignoredOutput
    .split('\0')
    .filter(Boolean)
    .map((ignoredPath) => ({ path: ignoredPath, index: '!', working_dir: '!' }))

  return [...files, ...ignored]
    .map((file) => {
      const resolvedFrom = file.from ? path.resolve(repositoryRoot, file.from) : undefined
      return {
        ...file,
        path: path.resolve(repositoryRoot, file.path),
        from: resolvedFrom && isPathInside(workspaceRoot, resolvedFrom) ? resolvedFrom : undefined
      }
    })
    .filter((file) => isPathInside(workspaceRoot, file.path))
}
