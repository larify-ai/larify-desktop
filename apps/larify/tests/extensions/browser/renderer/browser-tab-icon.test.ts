// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserTabIcon } from '../../../../src/extensions/browser/renderer/browser-tab-icon'

class MockImage {
  decoding = ''
  naturalHeight = 512
  naturalWidth = 1024
  onerror: (() => void) | null = null
  onload: (() => void) | null = null
  src = ''

  constructor() {
    images.push(this)
  }
}

const images: MockImage[] = []
const sourceContext = {
  drawImage: vi.fn(),
  getImageData: vi.fn(() => {
    const data = new Uint8ClampedArray(256 * 128 * 4)
    for (let index = 3; index < data.length; index += 4) data[index] = 255
    return { data }
  })
}
const targetContext = {
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  imageSmoothingEnabled: false,
  imageSmoothingQuality: 'low'
}

describe('BrowserTabIcon', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    images.length = 0
    vi.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('Image', MockImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return (this.classList.contains('size-4') ? targetContext : sourceContext) as never
    })
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 })
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const renderIcon = async (favicon = 'https://example.com/favicon.png'): Promise<void> => {
    await act(async () => root.render(createElement(BrowserTabIcon, { favicon })))
  }

  it('renders the fallback without creating an image for an empty favicon', async () => {
    await renderIcon('')

    expect(container.querySelector('svg')).toBeTruthy()
    expect(images).toHaveLength(0)
  })

  it('bounds large favicon analysis and draws a DPR-aware normalized icon', async () => {
    await renderIcon()
    await act(async () => images[0].onload?.())

    const canvases = container.querySelectorAll('canvas')
    expect(canvases).toHaveLength(1)
    expect(sourceContext.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 256, 128)
    expect(targetContext.drawImage).toHaveBeenCalledWith(images[0], 0, 0, 1024, 512, 6, 13, 28, 14)
    expect(canvases[0].width).toBe(40)
    expect(canvases[0].height).toBe(40)
    expect(targetContext.imageSmoothingEnabled).toBe(true)
    expect(targetContext.imageSmoothingQuality).toBe('high')
  })

  it('redraws the small destination canvas when the device pixel ratio changes', async () => {
    await renderIcon()
    await act(async () => images[0].onload?.())
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 })

    act(() => window.dispatchEvent(new Event('resize')))

    const canvas = container.querySelector('canvas')!
    expect(canvas.width).toBe(20)
    expect(canvas.height).toBe(20)
    expect(sourceContext.getImageData).toHaveBeenCalledOnce()
    expect(targetContext.drawImage).toHaveBeenCalledTimes(2)
  })

  it('falls back without leaking an exception when resize redraw becomes unavailable', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    await renderIcon()
    await act(async () => images[0].onload?.())
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => null)

    await act(async () => window.dispatchEvent(new Event('resize')))

    expect(container.querySelector('svg')).toBeTruthy()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
  })

  it('falls back when image loading or canvas analysis fails', async () => {
    await renderIcon()
    await act(async () => images[0].onerror?.())
    expect(container.querySelector('svg')).toBeTruthy()

    await renderIcon('https://example.com/other.png')
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(function () {
      return (this.classList.contains('size-4') ? targetContext : null) as never
    })
    await act(async () => images[1].onload?.())
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('detaches image and resize callbacks on unmount', async () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    await renderIcon()
    await act(async () => images[0].onload?.())
    const image = images[0]

    await act(async () => root.unmount())

    expect(image.onload).toBeNull()
    expect(image.onerror).toBeNull()
    expect(removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function))
    root = createRoot(container)
  })
})
