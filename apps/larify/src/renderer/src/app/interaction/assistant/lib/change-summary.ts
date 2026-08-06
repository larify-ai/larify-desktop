import type { UIMessage } from 'ai'

export interface ChangedFileSummary {
  additions: number
  deletions: number
  path: string
  patch: string
}

export interface ChangeSummary {
  additions: number
  deletions: number
  files: ChangedFileSummary[]
}

interface GitSnapshotData {
  files: ChangedFileSummary[]
}

function isChangedFile(value: unknown): value is ChangedFileSummary {
  if (!value || typeof value !== 'object') return false
  const { additions, deletions, patch, path } = value as Partial<ChangedFileSummary>
  return (
    typeof path === 'string' &&
    typeof patch === 'string' &&
    typeof additions === 'number' &&
    Number.isInteger(additions) &&
    additions >= 0 &&
    typeof deletions === 'number' &&
    Number.isInteger(deletions) &&
    deletions >= 0
  )
}

export function summarizeMessageChanges(message: UIMessage): ChangeSummary | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index] as { type: string; data?: unknown }
    if (part.type !== 'data-git-snapshot' || !part.data || typeof part.data !== 'object') continue
    const data = part.data as Partial<GitSnapshotData>
    if (!Array.isArray(data.files) || data.files.length === 0 || !data.files.every(isChangedFile))
      continue
    return {
      additions: data.files.reduce((total, file) => total + file.additions, 0),
      deletions: data.files.reduce((total, file) => total + file.deletions, 0),
      files: data.files
    }
  }
  return null
}
