import { describe, expect, it } from 'vitest'
import { calculateFaviconScale } from '../../../../src/extensions/browser/renderer/favicon-scale'

function pixels(width: number, height: number, visible: (x: number, y: number) => boolean) {
  const result = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      result[(y * width + x) * 4 + 3] = visible(x, y) ? 255 : 0
    }
  }
  return result
}

describe('calculateFaviconScale', () => {
  it('keeps a full-bleed favicon at its original size', () => {
    expect(calculateFaviconScale(pixels(16, 16, () => true), 16, 16)).toBe(1)
  })

  it('compensates uniformly for transparent padding', () => {
    const favicon = pixels(16, 16, (x, y) => x >= 2 && x < 14 && y >= 2 && y < 14)
    expect(calculateFaviconScale(favicon, 16, 16)).toBeCloseTo(4 / 3)
  })

  it('caps compensation for very small visible content', () => {
    const favicon = pixels(16, 16, (x, y) => x >= 6 && x < 10 && y >= 6 && y < 10)
    expect(calculateFaviconScale(favicon, 16, 16)).toBe(1.5)
  })

  it('keeps empty or invalid image data at its original size', () => {
    expect(calculateFaviconScale(new Uint8ClampedArray(16 * 16 * 4), 16, 16)).toBe(1)
    expect(calculateFaviconScale(new Uint8ClampedArray(), 16, 16)).toBe(1)
  })
})
