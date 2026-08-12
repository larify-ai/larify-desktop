import path from 'node:path'
import { gitService, type GitService } from './core'

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function head(
  workspaceRoot: string,
  file: string,
  runtime: GitService = gitService
): Promise<Uint8Array | null> {
  const git = await runtime.open(workspaceRoot)
  if (!(await git.checkIsRepo())) return null

  const repositoryRoot = path.resolve(await git.revparse(['--show-toplevel']))
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
