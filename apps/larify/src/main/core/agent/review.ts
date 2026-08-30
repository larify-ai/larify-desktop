import { isAbsolute, relative, resolve } from 'node:path'
import type { UIMessageChunk } from 'ai'
import { createTwoFilesPatch, diffLines } from 'diff'
import { isPathInside } from '../../utils/path'
import type { GitSnapshotFile, GitSnapshotPartData } from '../git/snapshot'
import type { FileMutation } from '../plugin/protocol'

const reviewPartId = 'review'

export const reviewChunk = (data: GitSnapshotPartData | null): UIMessageChunk => ({
  type: 'data-git-snapshot',
  id: reviewPartId,
  data
})

interface TrackedFileChange {
  additions: number
  binary: false
  deletions: number
  path: string
  patch: string | null
}

function displayPath(root: string, path: string): string {
  if (!isAbsolute(path)) return path
  const relativePath = relative(root, path)
  return relativePath && isPathInside(root, path) ? relativePath : path
}

function fileKey(path: string): string {
  const normalized = resolve(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Keeps the first content seen for each file and diffs it against the latest write. */
export class FileChangeTracker {
  private readonly files = new Map<string, { original: string | null; current: string }>()

  update({ path, before, after }: FileMutation): void {
    const key = fileKey(path)
    const existing = this.files.get(key)
    const original = existing ? existing.original : before
    this.files.set(key, { original, current: after })
  }

  result(path: string): TrackedFileChange | undefined {
    const file = this.files.get(fileKey(path))
    if (!file) return undefined
    if (file.original !== null && file.original === file.current) {
      return { path, patch: null, additions: 0, deletions: 0, binary: false }
    }
    const before = file.original ?? ''
    const changes = diffLines(before, file.current)
    return {
      path,
      patch: createTwoFilesPatch(path, path, before, file.current, '', '', {
        context: 3
      }),
      additions: changes.reduce(
        (total, change) => total + (change.added ? (change.count ?? 0) : 0),
        0
      ),
      deletions: changes.reduce(
        (total, change) => total + (change.removed ? (change.count ?? 0) : 0),
        0
      ),
      binary: false
    }
  }
}

/** Tracks successful file mutation tool results of one agent task (session-level). */
export class AgentReview {
  private readonly files = new Map<string, GitSnapshotFile>()
  private active = true

  constructor(
    private readonly root: string,
    private readonly emit: (chunk: UIMessageChunk) => void
  ) {}

  update(change: TrackedFileChange): void {
    if (!this.active) return
    const key = fileKey(change.path)
    const path = displayPath(this.root, change.path)
    if (change.patch === null) {
      this.files.delete(key)
      this.emit(reviewChunk(this.data()))
      return
    }
    this.files.set(key, {
      ...change,
      path,
      patch: change.patch
    })
    this.emit(reviewChunk(this.data()))
  }

  finish(): GitSnapshotPartData | null {
    return this.data()
  }

  dispose(): void {
    this.active = false
  }

  private data(): GitSnapshotPartData | null {
    const files = [...this.files.values()]
    return files.length ? { files, root: resolve(this.root) } : null
  }
}
