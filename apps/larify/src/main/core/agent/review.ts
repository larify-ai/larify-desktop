import { isAbsolute, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { UIMessageChunk } from 'ai'
import { createTwoFilesPatch, diffLines } from 'diff'
import { isPathInside } from '../../utils/path'
import { larifyPath } from '../../utils/app-paths'
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

const tasksRoot = larifyPath('tasks')
const memoryRoot = larifyPath('memory')

/**
 * Agent task/memory artifacts live under ~/.larify. They are kept in the card
 * (so the user can see them) but sorted below every other change.
 */
function isTasksPath(path: string): boolean {
  return isPathInside(tasksRoot, path)
}

function isMemoryPath(path: string): boolean {
  return isPathInside(memoryRoot, path)
}

/** Test files are sorted below normal changes, but above task/memory artifacts. */
function isTestPath(path: string): boolean {
  return path.toLowerCase().includes('test')
}

/**
 * Change-card display priority: normal files first, then test files, then task
 * artifacts, then memory artifacts. Lower value sorts higher in the card.
 */
function sortRank(path: string): number {
  if (isMemoryPath(path)) return 3
  if (isTasksPath(path)) return 2
  if (isTestPath(path)) return 1
  return 0
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
  private readonly files = new Map<
    string,
    { original: string | null; current: string; path: string }
  >()

  update({ path, before, after }: FileMutation): void {
    const key = fileKey(path)
    const existing = this.files.get(key)
    const original = existing ? existing.original : before
    this.files.set(key, { original, current: after, path })
  }

  /**
   * Checks every tracked file against the filesystem. A file deleted outside
   * the tracked tools (e.g. via the terminal) is reported as a whole-file
   * deletion (existing file) or as a removal signal (new file that never
   * survived on disk), so the review card drops it instead of keeping a stale
   * entry.
   */
  reconcile(): void {
    for (const [key, file] of this.files) {
      if (existsSync(key)) continue
      this.files.set(key, { original: file.original, current: '', path: file.path })
    }
  }

  /** Reconciles deletions, then returns the current diff for every tracked file. */
  syncResults(): TrackedFileChange[] {
    this.reconcile()
    const results: TrackedFileChange[] = []
    for (const file of this.files.values()) {
      const result = this.result(file.path)
      if (result) results.push(result)
    }
    return results
  }

  result(path: string): TrackedFileChange | undefined {
    const file = this.files.get(fileKey(path))
    if (!file) return undefined
    if (file.original !== null && file.original === file.current) {
      return { path, patch: null, additions: 0, deletions: 0, binary: false }
    }
    if (file.original === null && file.current === '') {
      // A newly created file that never survived on disk: drop it from the card.
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
    const files = [...this.files.values()].sort((a, b) => sortRank(a.path) - sortRank(b.path))
    return files.length ? { files, root: resolve(this.root) } : null
  }
}
