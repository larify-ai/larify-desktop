const maximumFaviconScale = 1.5
const visibleAlphaThreshold = 8

export function calculateFaviconScale(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): number {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return 1

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
  if (maxX < 0 || maxY < 0) return 1

  const contentSize = Math.max(maxX - minX + 1, maxY - minY + 1)
  return Math.min(
    maximumFaviconScale,
    Math.max(1, Math.max(width, height) / contentSize)
  )
}
