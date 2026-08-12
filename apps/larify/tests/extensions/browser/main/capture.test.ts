import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getBoxWithSession: vi.fn()
}))

vi.mock('../../../../src/extensions/browser/main/queries', () => ({
  getBoxWithSession: h.getBoxWithSession
}))

import {
  mapFrameBoxToTopLevel,
  screenshot
} from '../../../../src/extensions/browser/main/capture'

describe('element screenshot frame session', () => {
  beforeEach(() => vi.clearAllMocks())

  it('translates an OOPIF element box into top-level page coordinates', async () => {
    h.getBoxWithSession.mockResolvedValue({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: 'OOPIF',
      viewport: { width: 400, height: 300 }
    })
    const send = vi.fn(async (method: string, _params?: object, sessionId?: string) => {
      if (method === 'Runtime.evaluate' && sessionId === 'OOPIF') {
        return { result: { value: { width: 400, height: 300 } } }
      }
      if (method === 'Runtime.evaluate') return { result: { value: { x: 5, y: 6 } } }
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 42 }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [160, 130, 560, 130, 560, 430, 160, 430] } }
      }
      if (method === 'Page.captureScreenshot') return { data: 'image' }
      return {}
    })

    await expect(
      screenshot(
        { send, refMap: new Map(), sessions: new Map() },
        { selector: 'e1', format: 'png' }
      )
    ).resolves.toEqual({ data: 'image', mimeType: 'image/png' })

    expect(send).toHaveBeenCalledWith('DOM.getFrameOwner', { frameId: 'FRAME' })
    expect(h.getBoxWithSession).toHaveBeenCalledWith(expect.anything(), 'e1', true)
    expect(send).not.toHaveBeenCalledWith('Runtime.evaluate', expect.anything(), 'OOPIF')
    expect(send).toHaveBeenCalledWith('DOM.getBoxModel', { backendNodeId: 42 })
    expect(send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        clip: { x: 195, y: 176, width: 100, height: 60, scale: 1 }
      })
    )
  })

  it('keeps a top-level element in top-level document coordinates', async () => {
    h.getBoxWithSession.mockResolvedValue({
      box: { x: 30, y: 40, width: 100, height: 60 }
    })
    const send = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: { x: 11, y: 13 } } }
      if (method === 'Page.captureScreenshot') return { data: 'image' }
      return {}
    })

    await screenshot(
      { send, refMap: new Map(), sessions: new Map() },
      { selector: '#target', format: 'png' }
    )

    expect(send).not.toHaveBeenCalledWith('DOM.getFrameOwner', expect.anything())
    expect(send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        clip: { x: 41, y: 53, width: 100, height: 60, scale: 1 }
      })
    )
  })

  it('fails before capture when an OOPIF session cannot be mapped to a frame', async () => {
    h.getBoxWithSession.mockResolvedValue({
      box: { x: 30, y: 40, width: 100, height: 60 },
      sessionId: 'DETACHED'
    })
    const send = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0 } } }
      return {}
    })

    await expect(
      screenshot(
        { send, refMap: new Map(), sessions: new Map() },
        { selector: '@e1', format: 'png' }
      )
    ).rejects.toThrow('Could not map iframe session to its frame.')
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything())
  })

  it('fails before capture when the iframe owner has no usable content quad', async () => {
    h.getBoxWithSession.mockResolvedValue({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: 'OOPIF',
      viewport: { width: 400, height: 300 }
    })
    const send = vi.fn(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: { x: 0, y: 0 } } }
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 42 }
      if (method === 'DOM.getBoxModel') return { model: {} }
      return {}
    })

    await expect(
      screenshot(
        { send, refMap: new Map(), sessions: new Map() },
        { selector: '@e1', format: 'png' }
      )
    ).rejects.toThrow('Could not get iframe geometry.')
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything())
  })

  it('fails before capture when the child viewport geometry is unavailable', async () => {
    h.getBoxWithSession.mockResolvedValue({
      box: { x: 30, y: 40, width: 100, height: 60 },
      frameId: 'FRAME',
      sessionId: 'OOPIF'
    })
    const send = vi.fn(async (method: string) => {
      if (method === 'DOM.getFrameOwner') return { backendNodeId: 42 }
      if (method === 'DOM.getBoxModel') {
        return { model: { content: [160, 130, 560, 130, 560, 430, 160, 430] } }
      }
      return {}
    })

    await expect(
      screenshot(
        { send, refMap: new Map(), sessions: new Map() },
        { selector: '@e1', format: 'png' }
      )
    ).rejects.toThrow('Could not get iframe geometry.')
    expect(send).not.toHaveBeenCalledWith('Page.captureScreenshot', expect.anything())
  })

  it('preserves viewport screenshot behavior when no selector is provided', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return {
          cssVisualViewport: { pageX: 4, pageY: 6, clientWidth: 800, clientHeight: 600 }
        }
      }
      return method === 'Page.captureScreenshot' ? { data: 'viewport' } : {}
    })

    await expect(
      screenshot({ send, refMap: new Map() }, { format: 'jpeg', quality: 72 })
    ).resolves.toEqual({ data: 'viewport', mimeType: 'image/jpeg' })

    expect(h.getBoxWithSession).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('Page.captureScreenshot', {
      format: 'jpeg',
      fromSurface: true,
      optimizeForSpeed: true,
      quality: 72,
      clip: { x: 4, y: 6, width: 800, height: 600, scale: 1 },
      captureBeyondViewport: false
    })
  })

  it('preserves full-page capture behavior', async () => {
    const send = vi.fn(async (method: string) => {
      if (method === 'Page.getLayoutMetrics') {
        return { cssContentSize: { width: 1200, height: 2400 } }
      }
      if (method === 'Page.captureScreenshot') return { data: 'full-page' }
      return {}
    })

    await screenshot({ send, refMap: new Map() }, { fullPage: true })

    expect(send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      expect.objectContaining({
        clip: { x: 0, y: 0, width: 1200, height: 2400, scale: 1 },
        captureBeyondViewport: true
      })
    )
  })
})

describe('mapFrameBoxToTopLevel', () => {
  it('maps an axis-aligned iframe without changing element size', () => {
    expect(
      mapFrameBoxToTopLevel(
        { x: 30, y: 40, width: 100, height: 60 },
        [160, 130, 560, 130, 560, 430, 160, 430],
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 190, y: 170, width: 100, height: 60 })
  })

  it('maps a scaled iframe position and element size', () => {
    expect(
      mapFrameBoxToTopLevel(
        { x: 30, y: 40, width: 100, height: 60 },
        [162.5, 132.5, 662.5, 132.5, 662.5, 507.5, 162.5, 507.5],
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 200, y: 182.5, width: 125, height: 75 })
  })

  it('returns an axis-aligned bounding box for a rotated iframe', () => {
    expect(
      mapFrameBoxToTopLevel(
        { x: 0, y: 0, width: 100, height: 50 },
        [100, 100, 100, 500, -200, 500, -200, 100],
        { width: 400, height: 300 }
      )
    ).toEqual({ x: 50, y: 100, width: 50, height: 100 })
  })

  it('rejects incomplete geometry and a zero-sized viewport', () => {
    expect(() =>
      mapFrameBoxToTopLevel(
        { x: 0, y: 0, width: 10, height: 10 },
        [0, 0],
        { width: 100, height: 100 }
      )
    ).toThrow('Could not get iframe geometry.')
    expect(() =>
      mapFrameBoxToTopLevel(
        { x: 0, y: 0, width: 10, height: 10 },
        [0, 0, 100, 0, 100, 100, 0, 100],
        { width: 0, height: 100 }
      )
    ).toThrow('Could not get iframe geometry.')
  })
})
