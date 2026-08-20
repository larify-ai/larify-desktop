import path from 'node:path'
import { gitService, type GitService } from './core'
import { isPathInside } from '../../utils/path'
import { resolveRepositoryRoot } from './repository'

export async function head(
  workspaceRoot: string,
  file: string,
  runtime: GitService = gitService
): Promise<Uint8Array | null> {
  const git = await runtime.open(workspaceRoot)
  const repositoryRoot = await resolveRepositoryRoot(workspaceRoot, git)
  const target = path.resolve(file)
  if (!isPathInside(workspaceRoot, target) || !isPathInside(repositoryRoot, target)) {
    throw new Error('Path is outside the workspace repository')
  }

  const relative = path.relative(repositoryRoot, target).split(path.sep).join('/')
  try {
    const result = await runtime.exec(['show', `HEAD:${relative}`], repositoryRoot)
    return result.exitCode === 0 ? new Uint8Array(result.stdout) : null
  } catch {
    return null
  }
}
