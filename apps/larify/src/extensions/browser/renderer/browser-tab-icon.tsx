import { useState } from 'react'
import { GlobeIcon } from 'lucide-react'

export function BrowserTabIcon({ favicon }: { favicon: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  if (!favicon || failed) return <GlobeIcon aria-hidden />
  return (
    <img
      alt=""
      aria-hidden
      className="size-4"
      draggable={false}
      src={favicon}
      onError={() => setFailed(true)}
    />
  )
}
