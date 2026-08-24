import { useEffect, useRef, useState } from 'react'
import { GlobeIcon } from 'lucide-react'
import { faviconContentBounds } from './favicon-normalize'

const iconSize = 20
const contentSize = 14
const maximumAnalysisSize = 256
const maximumPixelRatio = 4

export function BrowserTabIcon({ favicon }: { favicon: string }): React.JSX.Element {
  const [failedFavicon, setFailedFavicon] = useState<string>()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!favicon) return

    const image = new Image()
    let redraw: (() => void) | undefined
    image.onload = () => {
      const canvas = canvasRef.current
      if (!canvas || !image.naturalWidth || !image.naturalHeight) {
        setFailedFavicon(favicon)
        return
      }

      try {
        const source = document.createElement('canvas')
        const analysisScale = Math.min(
          1,
          maximumAnalysisSize / Math.max(image.naturalWidth, image.naturalHeight)
        )
        source.width = Math.max(1, Math.round(image.naturalWidth * analysisScale))
        source.height = Math.max(1, Math.round(image.naturalHeight * analysisScale))
        const sourceContext = source.getContext('2d', { willReadFrequently: true })
        if (!sourceContext) throw new Error('Favicon analysis canvas is unavailable.')
        sourceContext.drawImage(image, 0, 0, source.width, source.height)

        const pixels = sourceContext.getImageData(0, 0, source.width, source.height).data
        const bounds = faviconContentBounds(pixels, source.width, source.height)
        const scaleX = image.naturalWidth / source.width
        const scaleY = image.naturalHeight / source.height
        const draw = (): boolean => {
          const target = canvasRef.current
          if (!target) return false
          const devicePixelRatio = window.devicePixelRatio
          const pixelRatio = Math.min(
            maximumPixelRatio,
            Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
          )
          target.width = Math.round(iconSize * pixelRatio)
          target.height = Math.round(iconSize * pixelRatio)
          const context = target.getContext('2d')
          if (!context) return false
          context.clearRect(0, 0, target.width, target.height)
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = 'high'

          const contentScale =
            (contentSize * pixelRatio) / Math.max(bounds.width * scaleX, bounds.height * scaleY)
          const drawWidth = bounds.width * scaleX * contentScale
          const drawHeight = bounds.height * scaleY * contentScale
          context.drawImage(
            image,
            bounds.x * scaleX,
            bounds.y * scaleY,
            bounds.width * scaleX,
            bounds.height * scaleY,
            (target.width - drawWidth) / 2,
            (target.height - drawHeight) / 2,
            drawWidth,
            drawHeight
          )
          return true
        }
        if (!draw()) throw new Error('Favicon display canvas is unavailable.')
        const handleResize = (): void => {
          try {
            if (draw()) return
          } catch {
            // Fall back below if a canvas becomes unavailable during a display change.
          }
          window.removeEventListener('resize', handleResize)
          setFailedFavicon(favicon)
        }
        redraw = handleResize
        window.addEventListener('resize', handleResize)
      } catch {
        setFailedFavicon(favicon)
      }
    }
    image.onerror = () => setFailedFavicon(favicon)
    image.decoding = 'async'
    image.src = favicon

    return () => {
      if (redraw) window.removeEventListener('resize', redraw)
      image.onload = null
      image.onerror = null
    }
  }, [favicon])

  if (!favicon || failedFavicon === favicon) {
    return <GlobeIcon aria-hidden className="larify-workbench-icon-browser" />
  }
  return <canvas ref={canvasRef} aria-hidden className="size-4" />
}
