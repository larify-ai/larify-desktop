import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentReview,
  FileChangeTracker,
  reviewChunk
} from '../../../../src/main/core/agent/review'

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
})
