import path from 'node:path'
import type { SimpleGit } from 'simple-git'

const repositoryRoots = new Map<string, string>()

export async function resolveRepositoryRoot(
  workspaceRoot: string,
  git: SimpleGit
): Promise<string> {
  const key = path.resolve(workspaceRoot)
  const cached = repositoryRoots.get(key)
  if (cached) return cached

  if (!(await git.checkIsRepo())) await git.init()
  const repositoryRoot = path.resolve(await git.revparse(['--show-toplevel']))
  repositoryRoots.set(key, repositoryRoot)
  return repositoryRoot
}
