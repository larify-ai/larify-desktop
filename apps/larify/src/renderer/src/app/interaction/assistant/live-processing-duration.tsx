import { useEffect, useState } from 'react'
import { formatProcessingDuration } from './processing-duration'

export function LiveProcessingDuration({ startedAt }: { startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return <>{formatProcessingDuration(startedAt, now)}</>
}
