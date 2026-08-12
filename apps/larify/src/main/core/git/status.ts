import path from 'node:path'
import type { FileStatusResult } from 'simple-git'
import { gitService, type GitService } from './core'

const isInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export async function status(
  workspaceRoot: string,
  runtime: GitService = gitService
): Promise<FileStatusResult[]> {
  const git = await runtime.open(workspaceRoot)
  if (!(await git.checkIsRepo())) throw new Error('Workspace is not a Git repository')

  const repositoryRoot = path.resolve(await git.revparse(['--show-toplevel']))
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
