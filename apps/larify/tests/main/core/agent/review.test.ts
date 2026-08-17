import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentReview, reviewChunk } from '../../../../src/main/core/agent/review'

const snapshot = {
  files: [{ additions: 1, deletions: 0, patch: '+change', path: 'file.ts' }],
  root: '/workspace'
}

describe('AgentReview', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('streams a snapshot shortly after a completed tool call', async () => {
    const compare = vi.fn().mockResolvedValue(snapshot)
    const emit = vi.fn()
    const review = new AgentReview({ compare } as never, { tree: 'before' } as never, emit)

    review.update()
    await vi.advanceTimersByTimeAsync(149)
    expect(compare).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(compare).toHaveBeenCalledOnce()
    expect(emit).toHaveBeenCalledWith(reviewChunk(snapshot))
    review.dispose()
  })

  it('clears a streamed card when all changes are reverted', async () => {
    const compare = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const emit = vi.fn()
    const review = new AgentReview({ compare } as never, { tree: 'before' } as never, emit)

    review.update()
    await vi.advanceTimersByTimeAsync(150)
    review.update()
    await vi.advanceTimersByTimeAsync(150)
    review.update()
    await vi.advanceTimersByTimeAsync(150)

    expect(emit).toHaveBeenNthCalledWith(1, reviewChunk(snapshot))
    expect(emit).toHaveBeenNthCalledWith(2, reviewChunk(null))
    expect(emit).toHaveBeenCalledTimes(2)
    review.dispose()
  })

  it('suppresses an in-flight comparison after disposal', async () => {
    const pending = deferred<typeof snapshot>()
    const compare = vi.fn().mockReturnValue(pending.promise)
    const emit = vi.fn()
    const review = new AgentReview({ compare } as never, { tree: 'before' } as never, emit)

    review.update()
    await vi.advanceTimersByTimeAsync(150)
    review.dispose()
    pending.resolve(snapshot)
    await pending.promise

    expect(emit).not.toHaveBeenCalled()
  })

  it('does not run or return a final comparison when disposed while finishing', async () => {
    const pending = deferred<typeof snapshot>()
    const compare = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(snapshot)
    const emit = vi.fn()
    const review = new AgentReview({ compare } as never, { tree: 'before' } as never, emit)

    review.update()
    await vi.advanceTimersByTimeAsync(150)
    const finishing = review.finish()
    review.dispose()
    pending.resolve(snapshot)

    await expect(finishing).resolves.toBeNull()
    expect(compare).toHaveBeenCalledOnce()
    expect(emit).not.toHaveBeenCalled()
  })

  it('publishes a final clear only while a streamed card is visible', async () => {
    const compare = vi
      .fn()
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    const emit = vi.fn()
    const review = new AgentReview({ compare } as never, { tree: 'before' } as never, emit)

    review.update()
    await vi.advanceTimersByTimeAsync(150)
    await review.finish()
    await review.finish()

    expect(emit).toHaveBeenNthCalledWith(1, reviewChunk(snapshot))
    expect(emit).toHaveBeenNthCalledWith(2, reviewChunk(null))
    expect(emit).toHaveBeenCalledTimes(2)
    review.dispose()
  })
})

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
