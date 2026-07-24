import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveRefToObjectId: vi.fn(),
  callOn: vi.fn()
}))

vi.mock('../../../../src/extensions/browser/main/refResolve', () => ({
  resolveRefToObjectId: h.resolveRefToObjectId
}))

vi.mock('../../../../src/extensions/browser/main/interactions', () => ({
  callOn: h.callOn
}))

import { getBox, getBoxWithSession, getCount } from '../../../../src/extensions/browser/main/queries'

describe('getBoxWithSession', () => {
  const ctx = {
    send: vi.fn(),
    refMap: new Map(),
    sessions: new Map([['FRAME', 'OOPIF']])
  }

  beforeEach(() => {
    ctx.send.mockClear()
    h.resolveRefToObjectId.mockResolvedValue({
      objectId: 'OID',
      frameId: 'FRAME',
      sessionId: 'OOPIF'
    })
    h.callOn.mockResolvedValue({ x: 30, y: 40, width: 100, height: 60 })
  })

  it('preserves the frame and session that own the resolved element', async () => {
    await expect(getBoxWithSession(ctx, '@e1')).resolves.toEqual({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: 'OOPIF'
    })
  })

  it('scrolls an OOPIF element into view only when requested', async () => {
    await getBoxWithSession(ctx, '@e1', true)

    expect(ctx.send).toHaveBeenCalledWith(
      'DOM.scrollIntoViewIfNeeded',
      { objectId: 'OID' },
      'OOPIF'
    )
  })

  it('scrolls a same-process iframe element without a child session', async () => {
    h.resolveRefToObjectId.mockResolvedValue({ objectId: 'OID', frameId: 'FRAME' })
    h.callOn.mockResolvedValue({
      x: 30,
      y: 40,
      width: 100,
      height: 60,
      viewportWidth: 400,
      viewportHeight: 300
    })

    await expect(getBoxWithSession(ctx, '@e1', true)).resolves.toEqual({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: undefined,
      viewport: { width: 400, height: 300 }
    })
    expect(ctx.send).toHaveBeenCalledWith(
      'DOM.scrollIntoViewIfNeeded',
      { objectId: 'OID' },
      undefined
    )
  })

  it('keeps the existing getBox return shape compatible', async () => {
    await expect(getBox(ctx, '@e1')).resolves.toEqual({
      x: 30,
      y: 40,
      width: 100,
      height: 60
    })
  })

  it('leaves frameId absent for a top-level element', async () => {
    h.resolveRefToObjectId.mockResolvedValue({ objectId: 'OID' })

    await expect(getBoxWithSession(ctx, '#target')).resolves.toEqual({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: undefined,
      sessionId: undefined
    })
    expect(ctx.send).not.toHaveBeenCalledWith(
      'DOM.scrollIntoViewIfNeeded',
      expect.anything(),
      expect.anything()
    )
  })

  it('preserves an unknown session so capture can reject a detached frame', async () => {
    h.resolveRefToObjectId.mockResolvedValue({ objectId: 'OID', sessionId: 'DETACHED' })

    await expect(getBoxWithSession(ctx, '@e1')).resolves.toEqual({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: undefined,
      sessionId: 'DETACHED'
    })
  })

  it('rejects a missing element box', async () => {
    h.callOn.mockResolvedValue(undefined)

    await expect(getBoxWithSession(ctx, '@e1')).rejects.toThrow(
      "could not get bounding box for '@e1'"
    )
  })
})

describe('getCount', () => {
  it('reports an invalid selector instead of returning zero', async () => {
    const send = vi.fn(async () => ({
      result: { type: 'object', subtype: 'error' },
      exceptionDetails: { text: 'SyntaxError: invalid selector' }
    }))

    await expect(getCount({ send: send as never }, 'input[')).rejects.toThrow(
      "selector 'input[' is invalid"
    )
  })
})
