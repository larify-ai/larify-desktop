import { describe, expect, it } from 'vitest'
import { faviconContentBounds } from '../../../../src/extensions/browser/renderer/favicon-normalize'

const pixels = (
  width: number,
  height: number,
  visible: (x: number, y: number) => boolean
): Uint8ClampedArray => {
  const result = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      result[(y * width + x) * 4 + 3] = visible(x, y) ? 255 : 0
    }
  }
  return result
}

describe('faviconContentBounds', () => {
  it('returns the complete bounds for an edge-to-edge favicon', () => {
    expect(
      faviconContentBounds(
        pixels(16, 16, () => true),
        16,
        16
      )
    ).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16
    })
  })

  it('trims transparent padding', () => {
    expect(
      faviconContentBounds(
        pixels(16, 16, (x, y) => x >= 2 && x <= 13 && y >= 3 && y <= 12),
        16,
        16
      )
    ).toEqual({ x: 2, y: 3, width: 12, height: 10 })
  })

  it('falls back to the complete image for empty pixels', () => {
    expect(faviconContentBounds(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16
    })
  })

  it('ignores nearly transparent antialiasing pixels', () => {
    const favicon = pixels(4, 4, (x, y) => x === 2 && y === 1)
    favicon[(0 * 4 + 0) * 4 + 3] = 8

    expect(faviconContentBounds(favicon, 4, 4)).toEqual({ x: 2, y: 1, width: 1, height: 1 })
  })

  it('returns safe bounds for invalid dimensions or incomplete pixel data', () => {
    expect(faviconContentBounds(new Uint8ClampedArray(), 16, 16)).toEqual({
      x: 0,
      y: 0,
      width: 16,
      height: 16
    })
    expect(faviconContentBounds(new Uint8ClampedArray(), 0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1
    })
  })
})
