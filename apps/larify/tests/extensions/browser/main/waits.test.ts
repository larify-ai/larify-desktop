import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isSelectorParseError,
  isTimeoutError,
  urlMatches,
  WaitTimeoutError,
  waitForOperationOrAbort,
  waitForFunction,
  waitForSelector,
  waitForStable,
  waitMs
} from '../../../../src/extensions/browser/main/waits'

describe('waitForOperationOrAbort', () => {
  it('handles a later operation rejection when the signal is already aborted', async () => {
    let rejectOperation!: (error: Error) => void
    const operation = new Promise<void>((_resolve, reject) => {
      rejectOperation = reject
    })
    const controller = new AbortController()
    controller.abort()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      await expect(waitForOperationOrAbort(operation, controller.signal)).rejects.toThrow(
        'operation aborted'
      )

      rejectOperation(new Error('late operation failure'))
      await new Promise((resolve) => setImmediate(resolve))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})

describe('waitMs abort handling', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(waitMs(50_000, controller.signal)).resolves.toBeUndefined()
  })

  it('resolves early when aborted mid-wait instead of waiting out the timeout', async () => {
    const controller = new AbortController()
    let resolved = false
    const pending = waitMs(50_000, controller.signal).then(() => {
      resolved = true
    })

    await vi.advanceTimersByTimeAsync(10)
    expect(resolved).toBe(false)

    controller.abort()
    await pending
    expect(resolved).toBe(true)
  })
})

describe('poll retries transient evaluation failures', () => {
  it('stops polling when the operation is aborted', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => ({ result: { value: false } }))
    const pending = waitForSelector(send as never, '.missing', 'visible', 50_000, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow('aborted')
  })

  it('cancels while the current page evaluation is still pending', async () => {
    const controller = new AbortController()
    const send = vi.fn(() => new Promise<never>(() => {}))
    const pending = waitForSelector(send as never, '.missing', 'visible', 50_000, controller.signal)

    controller.abort()

    await expect(pending).rejects.toThrow('aborted')
  })

  it('keeps polling when a page evaluation throws, then resolves once it succeeds', async () => {
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('Execution context was destroyed')
      return { result: { value: true } }
    })

    await expect(waitForFunction(send as never, 'ready', 5000)).resolves.toBeUndefined()
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it.each([
    'tab was closed',
    'Target closed',
    'Object has been destroyed',
    'Debugger is not attached'
  ])('reports terminal CDP failure immediately: %s', async (message) => {
    const send = vi.fn().mockRejectedValue(new Error(message))

    await expect(waitForSelector(send as never, '#target', 'visible', 25_000)).rejects.toThrow(
      message
    )
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('times out with a labeled error when the condition never holds', async () => {
    const send = vi.fn(async () => ({ result: { value: false } }))
    await expect(waitForFunction(send as never, 'never', 0)).rejects.toThrow(
      'wait_for_function timed out'
    )
  })

  it('reports an invalid selector immediately with its parse error', async () => {
    const send = vi.fn(async () => ({
      exceptionDetails: {
        text: 'Uncaught',
        exception: { description: "SyntaxError: Failed to execute 'querySelector'" }
      }
    }))

    await expect(waitForSelector(send as never, 'input[', 'visible', 0)).rejects.toThrow(
      "SyntaxError: Failed to execute 'querySelector'"
    )
  })

  it.each(['visible', 'hidden'] as const)(
    'checks ancestor visibility and element geometry for %s',
    async (state) => {
      const send = vi.fn(async (_method: string, params: { expression: string }) => {
        expect(params.expression).toContain('parentElement')
        expect(params.expression).toContain('getRootNode')
        expect(params.expression).toContain('getBoundingClientRect')
        return { result: { value: true } }
      })

      await waitForSelector(send as never, '#target', state, 0)
    }
  )
})

describe('urlMatches', () => {
  it('matches wildcards and literal substrings', () => {
    expect(urlMatches('*', 'https://any')).toBe(true)
    expect(urlMatches('example.com', 'https://example.com/x')).toBe(true)
    expect(urlMatches('https://*/checkout', 'https://shop.test/checkout')).toBe(true)
    expect(urlMatches('https://*/checkout', 'https://shop.test/cart')).toBe(false)
  })
})

describe('waitForStable', () => {
  const values = (sequence: unknown[]): (() => { result: { value: unknown } }) => {
    let index = 0
    return () => {
      const value = sequence[Math.min(index, sequence.length - 1)]
      index += 1
      return { result: { value } }
    }
  }

  it('resolves as soon as the value repeats `stableTimes` times', async () => {
    const send = vi.fn(values([['a'], ['a'], ['b']]))
    const result = await waitForStable(send as never, 'shape', {
      pollMs: 1,
      stableTimes: 2,
      timeoutMs: 2000
    })
    // ["a"] twice already satisfies "identical for 2 consecutive samples", so it settles
    // before ["b"] is ever observed. Callers rely on the criterion `null`-ing the
    // placeholder state to avoid this; here we assert the raw primitive's semantics.
    expect(result).toEqual(['a'])
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('re-settles on a later value when the criterion withholds the early samples', async () => {
    // Mirrors the real criterion: the empty placeholder reports `null`, so the streak only
    // starts at the final shape.
    const send = vi.fn(values([null, ['a'], ['a'], ['a']]))
    const result = await waitForStable(send as never, 'shape', {
      pollMs: 1,
      stableTimes: 2,
      timeoutMs: 2000
    })
    expect(result).toEqual(['a'])
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('ignores null samples instead of treating them as stable', async () => {
    const send = vi.fn(values([null, null, ['a'], ['a']]))
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, stableTimes: 2, timeoutMs: 2000 })
    ).resolves.toEqual(['a'])
  })

  it('keeps polling when the count keeps changing, then times out', async () => {
    let count = 0
    const send = vi.fn(async () => ({ result: { value: [++count] } }))
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, stableTimes: 2, timeoutMs: 30 })
    ).rejects.toThrow('wait_for_stable timed out')
  })

  it('aborts when the signal is aborted', async () => {
    const controller = new AbortController()
    const send = vi.fn(async () => ({ result: { value: null } }))
    const pending = waitForStable(
      send as never,
      'shape',
      { pollMs: 1, timeoutMs: 50_000 },
      controller.signal
    )
    controller.abort()
    await expect(pending).rejects.toThrow('aborted')
  })

  it('aborts when the signal is already aborted before the first sample', async () => {
    const controller = new AbortController()
    controller.abort()
    const send = vi.fn(async () => ({ result: { value: ['a'] } }))
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, timeoutMs: 1000 }, controller.signal)
    ).rejects.toThrow('aborted')
    expect(send).not.toHaveBeenCalled()
  })

  it('propagates a terminal CDP error immediately', async () => {
    const send = vi.fn().mockRejectedValue(new Error('tab was closed'))
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, timeoutMs: 1000 })
    ).rejects.toThrow('tab was closed')
  })

  it('settles on the FIRST non-null sample when stableTimes is 1', async () => {
    // `stableTimes: 1` means "one sample is enough". It must not require a repeat, otherwise a
    // caller asking for the loosest possible contract would ALWAYS time out on a changing value.
    let calls = 0
    const send = vi.fn(async () => ({ result: { value: { n: ++calls } } }))
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, stableTimes: 1, timeoutMs: 200 })
    ).resolves.toEqual({ n: 1 })
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('retries a transient evaluation failure before settling (parity with poll)', async () => {
    // `Execution context was destroyed` is the signature error of a hydration/soft navigation
    // — exactly the situation this primitive exists for. `poll` retries it, so this must too;
    // dying on the first mismatch would make the hydration wait less reliable than the selector
    // wait it is meant to strengthen.
    let calls = 0
    const send = vi.fn(async () => {
      calls += 1
      if (calls === 1) throw new Error('Execution context was destroyed')
      return { result: { value: ['a'] } }
    })
    await expect(
      waitForStable(send as never, 'shape', { pollMs: 1, stableTimes: 2, timeoutMs: 1000 })
    ).resolves.toEqual(['a'])
    expect(calls).toBeGreaterThanOrEqual(3)
  })

  it('retries a transient failure the same way waitForSelector does', async () => {
    const transient = 'Execution context was destroyed, most likely because of a navigation'
    let selectorCalls = 0
    const selectorSend = vi.fn(async () => {
      selectorCalls += 1
      if (selectorCalls === 1) throw new Error(transient)
      return { result: { value: true } }
    })
    let stableCalls = 0
    const stableSend = vi.fn(async () => {
      stableCalls += 1
      if (stableCalls === 1) throw new Error(transient)
      return { result: { value: ['a'] } }
    })

    await expect(
      waitForSelector(selectorSend as never, '#x', 'attached', 1000)
    ).resolves.toBeUndefined()
    await expect(
      waitForStable(stableSend as never, 'shape', { pollMs: 1, stableTimes: 2, timeoutMs: 1000 })
    ).resolves.toEqual(['a'])

    expect(selectorCalls).toBe(2)
    expect(stableCalls).toBeGreaterThanOrEqual(3)
  })

  it('throws a detectable WaitTimeoutError on timeout', async () => {
    const send = vi.fn(async () => ({ result: { value: null } }))
    const error = await waitForStable(send as never, 'shape', {
      pollMs: 1,
      timeoutMs: 20
    }).catch((e: unknown) => e)

    // Callers fall back on "the deadline elapsed" and propagate everything else, so the timeout
    // must be recognisable STRUCTURALLY — never by matching the message text.
    expect(isTimeoutError(error)).toBe(true)
    expect(error).toBeInstanceOf(WaitTimeoutError)
    expect((error as Error).message).toContain('wait_for_stable timed out')
  })
})

describe('wait error classification', () => {
  it('classifies a poll timeout as a WaitTimeoutError too', async () => {
    const send = vi.fn(async () => ({ result: { value: false } }))
    const error = await waitForFunction(send as never, 'never', 0).catch((e: unknown) => e)
    expect(isTimeoutError(error)).toBe(true)
  })

  it('does NOT classify other failures as timeouts', () => {
    expect(isTimeoutError(new Error('timed out after 5s'))).toBe(false)
    expect(isTimeoutError(new Error('tab was closed'))).toBe(false)
    expect(isTimeoutError('timed out after 5s')).toBe(false)
    expect(isTimeoutError(undefined)).toBe(false)
  })

  it('recognises a selector parse failure but not a terminal transport error', () => {
    expect(
      isSelectorParseError(new Error("SyntaxError: Failed to execute 'querySelector' on 'Document'"))
    ).toBe(true)
    expect(isSelectorParseError(new Error("'input[' is not a valid selector"))).toBe(true)
    expect(isSelectorParseError(new Error('XPath evaluation failed'))).toBe(true)
    expect(isSelectorParseError(new Error('tab was closed'))).toBe(false)
    expect(isSelectorParseError('SyntaxError')).toBe(false)
  })
})
