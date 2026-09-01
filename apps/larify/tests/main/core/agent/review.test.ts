import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  AgentReview,
  FileChangeTracker,
  reviewChunk
} from '../../../../src/main/core/agent/review'
import { larifyPath } from '../../../../src/main/utils/app-paths'

const tempDirs: string[] = []
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('FileChangeTracker', () => {
  it('replaces repeated edits with one diff from the original to the latest content', () => {
    const tracker = new FileChangeTracker()
    const path = resolve('file.ts')

    tracker.update({ path, before: 'const value = 1\n', after: 'const value = 2\n' })
    tracker.update({
      path,
      before: 'const value = 2\n',
      after: 'const value = 3\n'
    })
    const result = tracker.result(path)

    expect(result.patch).toContain('-const value = 1')
    expect(result.patch).toContain('+const value = 3')
    expect(result.patch).not.toContain('const value = 2')
  })

  it.runIf(process.platform === 'win32')(
    'treats differently cased Windows paths as the same file',
    () => {
      const tracker = new FileChangeTracker()
      const path = resolve('file.ts')
      const differentlyCasedPath = path.toUpperCase()

      tracker.update({ path, before: 'first\n', after: 'second\n' })
      tracker.update({
        path: differentlyCasedPath,
        before: 'second\n',
        after: 'third\n'
      })

      const result = tracker.result(differentlyCasedPath)
      expect(result?.patch).toContain('-first')
      expect(result?.patch).toContain('+third')
      expect(result?.patch).not.toContain('second')
    }
  )

  it('removes a file that is changed back to its original content', () => {
    const tracker = new FileChangeTracker()
    const path = resolve('file.ts')

    tracker.update({ path, before: 'original\n', after: 'changed\n' })

    tracker.update({ path, before: 'changed\n', after: 'original\n' })

    expect(tracker.result(path)).toEqual({
      path,
      patch: null,
      additions: 0,
      deletions: 0,
      binary: false
    })
  })

  it('keeps an empty baseline when a newly created file is written again', () => {
    const tracker = new FileChangeTracker()
    const path = resolve('new.ts')

    tracker.update({ path, before: null, after: 'first\n' })
    tracker.update({ path, before: 'first\n', after: 'second\n' })
    const result = tracker.result(path)

    expect(result.patch).toContain('+second')
    expect(result.patch).not.toContain('-first')
  })

  it('uses line diff counts for content that looks like a patch header', () => {
    const tracker = new FileChangeTracker()
    const path = resolve('file.ts')

    tracker.update({ path, before: '--- old\n', after: '+++ new\n' })

    expect(tracker.result(path)).toMatchObject({ additions: 1, deletions: 1 })
  })

  it('reports a tracked file deleted outside the tools as a whole-file deletion', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larify-review-'))
    tempDirs.push(dir)
    const path = join(dir, 'file.ts')
    writeFileSync(path, 'new\n')
    const tracker = new FileChangeTracker()
    tracker.update({ path, before: 'old\n', after: 'new\n' })

    rmSync(path) // deleted via the terminal, outside the tracked tools

    const [result] = tracker.syncResults()
    expect(result).toBeDefined()
    expect(result.path).toBe(path)
    expect(result.additions).toBe(0)
    expect(result.deletions).toBeGreaterThan(0)
    expect(result.patch).toContain('-old')
  })

  it('emits a removal signal for a newly created file that never survived on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larify-review-'))
    tempDirs.push(dir)
    const tracker = new FileChangeTracker()
    tracker.update({ path: join(dir, 'draft.md'), before: null, after: 'draft\n' })

    // The file never made it to disk: reconcile reports a removal (patch: null)
    // so the review card drops the stale "new file" entry.
    const [result] = tracker.syncResults()
    expect(result).toMatchObject({
      path: join(dir, 'draft.md'),
      patch: null,
      additions: 0,
      deletions: 0
    })
  })

  it('ignores task and memory artifacts under ~/.larify', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larify-review-'))
    tempDirs.push(dir)
    const appPath = join(dir, 'app.ts')
    writeFileSync(appPath, 'code\n')
    const tracker = new FileChangeTracker()
    tracker.update({
      path: join(larifyPath('tasks'), 'task-1', 'task.md'),
      before: null,
      after: '# Task\n'
    })
    tracker.update({
      path: join(larifyPath('memory'), 'subject.md'),
      before: null,
      after: 'knowledge\n'
    })
    tracker.update({ path: appPath, before: null, after: 'code\n' })

    const paths = tracker.syncResults().map((result) => result.path)
    expect(paths).toEqual([appPath])
  })
})

describe('AgentReview', () => {
  it.runIf(process.platform === 'win32')(
    'keeps one card entry for differently cased paths to the same Windows file',
    () => {
      const root = resolve('workspace')
      const path = resolve(root, 'File.ts')
      const differentlyCasedPath = path.toLowerCase()
      const review = new AgentReview(root, vi.fn())

      review.update({
        path,
        patch: '-first\n+second',
        additions: 1,
        deletions: 1,
        binary: false
      })
      review.update({
        path: differentlyCasedPath,
        patch: '-first\n+third',
        additions: 1,
        deletions: 1,
        binary: false
      })

      expect(review.finish()?.files).toEqual([
        {
          path: 'file.ts',
          patch: '-first\n+third',
          additions: 1,
          deletions: 1,
          binary: false
        }
      ])
    }
  )

  it('keeps root files whose names start with two dots relative', () => {
    const root = resolve('workspace')
    const path = resolve(root, '..config')
    const review = new AgentReview(root, vi.fn())

    review.update({ path, patch: '+change', additions: 1, deletions: 0, binary: false })

    expect(review.finish()?.files[0].path).toBe('..config')
  })

  it('replaces the displayed patch for a file and recalculates its counts', () => {
    const root = resolve('workspace')
    const path = resolve(root, 'file.ts')
    const emit = vi.fn()
    const review = new AgentReview(root, emit)

    review.update({
      path,
      patch: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+middle',
      additions: 1,
      deletions: 1,
      binary: false
    })
    review.update({
      path,
      patch: '--- a\n+++ b\n@@ -1 +1,2 @@\n-old\n+latest\n+line',
      additions: 2,
      deletions: 1,
      binary: false
    })

    expect(review.finish()).toEqual({
      root,
      files: [
        {
          path: 'file.ts',
          patch: '--- a\n+++ b\n@@ -1 +1,2 @@\n-old\n+latest\n+line',
          additions: 2,
          deletions: 1,
          binary: false
        }
      ]
    })
    expect(emit).toHaveBeenLastCalledWith(reviewChunk(review.finish()))
  })

  it('clears the displayed card when the final patch is null', () => {
    const root = resolve('workspace')
    const path = resolve(root, 'file.ts')
    const emit = vi.fn()
    const review = new AgentReview(root, emit)

    review.update({
      path,
      patch: '--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new',
      additions: 1,
      deletions: 1,
      binary: false
    })
    review.update({ path, patch: null, additions: 0, deletions: 0, binary: false })

    expect(review.finish()).toBeNull()
    expect(emit).toHaveBeenLastCalledWith(reviewChunk(null))
  })

  it('ignores updates after disposal', () => {
    const emit = vi.fn()
    const review = new AgentReview(resolve('workspace'), emit)
    review.dispose()

    review.update({
      path: 'file.ts',
      patch: '+change',
      additions: 1,
      deletions: 0,
      binary: false
    })

    expect(review.finish()).toBeNull()
    expect(emit).not.toHaveBeenCalled()
  })

  it('drops a newly created file deleted after the last write from the final card', () => {
    const dir = mkdtempSync(join(tmpdir(), 'larify-review-'))
    tempDirs.push(dir)
    const path = join(dir, 'draft.ts')
    writeFileSync(path, 'draft\n')
    const tracker = new FileChangeTracker()
    const review = new AgentReview(dir, vi.fn())

    tracker.update({ path, before: null, after: 'draft\n' })
    for (const tracked of tracker.syncResults()) review.update(tracked)
    expect(review.finish()?.files).toHaveLength(1)

    rmSync(path) // deleted outside the tools after the last write

    for (const tracked of tracker.syncResults()) review.update(tracked)
    expect(review.finish()).toBeNull()
  })
})
