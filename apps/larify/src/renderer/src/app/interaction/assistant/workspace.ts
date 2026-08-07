export function workspaceName(path: string): string {
  if (workspaceKey(path) === 'default') return '默认空间'
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? '默认空间'
}

export function workspaceKey(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase()
  return !normalized || normalized.endsWith('/.larify/workspace') ? 'default' : normalized
}

export function uniqueWorkspaces(paths: string[]): string[] {
  const workspaces = new Map<string, string>()
  for (const path of paths) {
    const key = workspaceKey(path)
    if (!workspaces.has(key)) workspaces.set(key, path)
  }
  return [...workspaces.values()]
}
