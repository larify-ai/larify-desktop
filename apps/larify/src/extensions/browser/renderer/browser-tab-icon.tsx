import { useState } from 'react'
import { GlobeIcon } from 'lucide-react'
import { calculateFaviconScale } from './favicon-scale'

export function BrowserTabIcon({ favicon }: { favicon: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const [scale, setScale] = useState(1)
  if (!favicon || failed) {
    return <GlobeIcon aria-hidden className="larify-workbench-icon-browser" />
  }
  return (
    <img
      alt=""
      aria-hidden
      className="size-4"
      draggable={false}
      src={favicon}
      style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        const image = event.currentTarget
        const width = image.naturalWidth
        const height = image.naturalHeight
        if (!width || !height) return
        try {
          const canvas = document.createElement('canvas')
          canvas.width = width
          canvas.height = height
          const context = canvas.getContext('2d', { willReadFrequently: true })
          if (!context) return
          context.drawImage(image, 0, 0)
          const pixels = context.getImageData(0, 0, width, height).data
          setScale(calculateFaviconScale(pixels, width, height))
        } catch {
          setScale(1)
        }
      }}
    />
  )
}
