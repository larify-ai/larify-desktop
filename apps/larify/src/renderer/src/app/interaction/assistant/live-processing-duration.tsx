import { useEffect, useState } from 'react'
import { formatProcessingDurationMs } from './processing-duration'

export function LiveProcessingDuration({
  startedAt,
  baseMs = 0
}: {
  startedAt: number
  baseMs?: number
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return <>{formatProcessingDurationMs(baseMs + Math.max(0, now - startedAt))}</>
}
