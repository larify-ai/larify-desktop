import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/extensions/browser/main/refResolve', () => ({
  resolveRefToBox: vi.fn()
}))

import { drag } from '../../../../src/extensions/browser/main/interactions'
import { resolveRefToBox } from '../../../../src/extensions/browser/main/refResolve'

interface Call {
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

function makeCtx(): { ctx: Parameters<typeof drag>[0]; calls: Call[] } {
  const calls: Call[] = []
  const send = vi.fn(
    async (method: string, params: Record<string, unknown>, sessionId?: string) => {
      calls.push({ method, params, sessionId })
      return {}
    }
  )
  return {
    ctx: { send, refMap: new Map() } as Parameters<typeof drag>[0],
    calls
  }
}

describe('drag frame sessions', () => {
  it('rejects cross-frame drag before dispatching input', async () => {
    vi.mocked(resolveRefToBox)
      .mockResolvedValueOnce({ x: 10, y: 20, sessionId: 'SOURCE' })
      .mockResolvedValueOnce({ x: 30, y: 40, sessionId: 'TARGET' })
    const { ctx, calls } = makeCtx()

    await expect(drag(ctx, '#source', '#target')).rejects.toThrow(
      'Cross-frame drag is not supported.'
    )
    expect(calls).toHaveLength(0)
  })

  it('rejects drag between same-process frames with no child sessions', async () => {
    vi.mocked(resolveRefToBox)
      .mockResolvedValueOnce({ x: 10, y: 20, frameId: 'FRAME-A' })
      .mockResolvedValueOnce({ x: 30, y: 40, frameId: 'FRAME-B' })
    const { ctx, calls } = makeCtx()

    await expect(drag(ctx, '#source', '#target')).rejects.toThrow(
      'Cross-frame drag is not supported.'
    )
    expect(calls).toHaveLength(0)
  })

  it.each([undefined, 'OOPIF'])(
    'keeps same-frame drag events in session %s',
    async (sessionId) => {
      vi.mocked(resolveRefToBox)
        .mockResolvedValueOnce({ x: 10, y: 20, sessionId })
        .mockResolvedValueOnce({ x: 30, y: 40, sessionId })
      const { ctx, calls } = makeCtx()

      await drag(ctx, '#source', '#target')

      expect(calls).toHaveLength(13)
      expect(calls.every((call) => call.sessionId === sessionId)).toBe(true)
      expect(calls[1].params).toMatchObject({ type: 'mousePressed', x: 10, y: 20 })
      expect(calls.at(-1)?.params).toMatchObject({
        type: 'mouseReleased',
        x: 30,
        y: 40
      })
    }
  )
})
