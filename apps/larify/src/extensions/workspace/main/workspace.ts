import { realpath, stat } from 'node:fs/promises'

export async function resolveWorkspace(root: string): Promise<string> {
  const resolved = await realpath(root)
  if (!(await stat(resolved)).isDirectory()) throw new Error('Workspace path is not a directory')
  return resolved
}
