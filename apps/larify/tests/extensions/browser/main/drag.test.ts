import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../../src/extensions/browser/main/refResolve', () => ({
  resolveRefToBox: vi.fn(),
  resolveRefToObjectId: vi.fn(async () => ({ objectId: 'SOURCE' }))
}))

import { drag } from '../../../../src/extensions/browser/main/interactions'
import {
  resolveRefToBox,
  resolveRefToObjectId
} from '../../../../src/extensions/browser/main/refResolve'

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
      if (method === 'Runtime.callFunctionOn') return { result: { value: true } }
      return {}
    }
  )
  return {
    ctx: {
      send,
      waitForEvent: vi.fn(async () => ({
        data: { items: [], dragOperationsMask: 1 }
      })),
      refMap: new Map()
    } as Parameters<typeof drag>[0],
    calls
  }
}

describe('drag frame sessions', () => {
  it('dispatches HTML5 drag events instead of only moving a pressed mouse', async () => {
    vi.mocked(resolveRefToBox)
      .mockResolvedValueOnce({ x: 10, y: 20 })
      .mockResolvedValueOnce({ x: 30, y: 40 })
    const { ctx, calls } = makeCtx()

    await drag(ctx, '#source', '#target')

    expect(calls.some(({ method }) => method === 'Input.setInterceptDrags')).toBe(true)
    expect(calls.some(({ method }) => method === 'Input.dispatchDragEvent')).toBe(true)
  })

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
      vi.mocked(resolveRefToObjectId).mockResolvedValueOnce({ objectId: 'SOURCE', sessionId })
      const { ctx, calls } = makeCtx()

      await drag(ctx, '#source', '#target')

      expect(calls).toHaveLength(19)
      expect(calls.every((call) => call.sessionId === sessionId)).toBe(true)
      expect(calls.some(({ params }) =>
        params.type === 'mousePressed' && params.x === 10 && params.y === 20
      )).toBe(true)
      expect(calls.some(({ method, params }) =>
        method === 'Input.dispatchDragEvent' && params.type === 'drop'
      )).toBe(true)
      expect(calls.at(-1)).toMatchObject({
        method: 'Input.setInterceptDrags',
        params: { enabled: false }
      })
    }
  )

  it('best-effort releases the mouse after an intermediate move fails', async () => {
    vi.mocked(resolveRefToBox)
      .mockResolvedValueOnce({ x: 10, y: 20 })
      .mockResolvedValueOnce({ x: 30, y: 40 })
    const calls: Call[] = []
    let moves = 0
    const send = vi.fn(
      async (method: string, params: Record<string, unknown>, sessionId?: string) => {
        calls.push({ method, params, sessionId })
        if (method === 'Runtime.callFunctionOn') return { result: { value: true } }
        if (params.type === 'mouseMoved' && ++moves === 4) {
          throw new Error('intermediate move failed')
        }
        return {}
      }
    )
    const ctx = {
      send,
      waitForEvent: vi.fn(async () => ({
        data: { items: [], dragOperationsMask: 1 }
      })),
      refMap: new Map()
    } as Parameters<typeof drag>[0]

    await expect(drag(ctx, '#source', '#target')).rejects.toThrow(
      'intermediate move failed'
    )
    expect(calls.some(({ params }) => params.type === 'mousePressed')).toBe(true)
    expect(calls.some(({ params }) => params.type === 'mouseReleased')).toBe(true)
    expect(calls.at(-1)).toMatchObject({
      method: 'Input.setInterceptDrags',
      params: { enabled: false }
    })
  })

  it('keeps pointer-based drag working without waiting for HTML5 drag data', async () => {
    vi.mocked(resolveRefToBox)
      .mockResolvedValueOnce({ x: 10, y: 20 })
      .mockResolvedValueOnce({ x: 30, y: 40 })
    const { ctx, calls } = makeCtx()
    vi.mocked(ctx.send).mockImplementation(async (method, params, sessionId) => {
      calls.push({ method, params, sessionId })
      if (method === 'Runtime.callFunctionOn') return { result: { value: false } }
      return {}
    })

    await drag(ctx, '#source', '#target')

    expect(calls.some(({ method }) => method === 'Input.setInterceptDrags')).toBe(false)
    expect(calls.some(({ params }) => params.type === 'mouseReleased')).toBe(true)
  })
})
