const visibleAlphaThreshold = 8

export interface FaviconContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export function faviconContentBounds(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): FaviconContentBounds {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) {
    return { x: 0, y: 0, width: Math.max(1, width), height: Math.max(1, height) }
  }

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] <= visibleAlphaThreshold) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < 0 || maxY < 0) return { x: 0, y: 0, width, height }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}
