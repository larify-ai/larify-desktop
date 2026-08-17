import type { UIMessage } from 'ai'

export interface ChangedFileSummary {
  additions: number
  binary?: boolean
  deletions: number
  path: string
  patch: string
}

export interface ChangeSummary {
  additions: number
  deletions: number
  files: ChangedFileSummary[]
  root?: string
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

function isChangedFile(value: unknown): value is ChangedFileSummary {
  if (!value || typeof value !== 'object') return false
  const { additions, binary, deletions, patch, path } = value as Partial<ChangedFileSummary>
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\0') &&
    typeof patch === 'string' &&
    (binary === undefined || typeof binary === 'boolean') &&
    isCount(additions) &&
    isCount(deletions)
  )
}

export function summarizeMessageChanges(message: UIMessage): ChangeSummary | null {
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    const part = message.parts[index] as { type: string; data?: unknown }
    if (part.type !== 'data-git-snapshot') continue
    if (!part.data || typeof part.data !== 'object') return null
    const { files, root } = part.data as { files?: unknown; root?: unknown }
    if (!Array.isArray(files) || files.length === 0 || !files.every(isChangedFile)) return null
    if (new Set(files.map((file) => file.path)).size !== files.length) return null
    if (root !== undefined && (typeof root !== 'string' || !root || root.includes('\0')))
      return null
    const additions = files.reduce((total, file) => total + file.additions, 0)
    const deletions = files.reduce((total, file) => total + file.deletions, 0)
    if (!isCount(additions) || !isCount(deletions)) return null
    return {
      additions,
      deletions,
      files,
      ...(root ? { root } : {})
    }
  }
  return null
}
