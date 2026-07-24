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

import { getBox, getBoxWithSession } from '../../../../src/extensions/browser/main/queries'

describe('getBoxWithSession', () => {
  const ctx = {
    send: vi.fn(),
    refMap: new Map(),
    sessions: new Map([['FRAME', 'OOPIF']])
  }

  beforeEach(() => {
    h.resolveRefToObjectId.mockResolvedValue({ objectId: 'OID', sessionId: 'OOPIF' })
    h.callOn.mockResolvedValue({ x: 30, y: 40, width: 100, height: 60 })
  })

  it('preserves the frame and session that own the resolved element', async () => {
    await expect(getBoxWithSession(ctx, '@e1')).resolves.toEqual({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: 'OOPIF'
    })
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
