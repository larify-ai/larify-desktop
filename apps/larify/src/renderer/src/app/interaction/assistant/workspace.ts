export function workspaceName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '默认空间'
}

export function uniqueWorkspaces(paths: string[]): string[] {
  return [...new Set(paths)]
}
