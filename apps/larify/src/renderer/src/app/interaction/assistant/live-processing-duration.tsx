import { useEffect, useState } from 'react'
import { formatProcessingDurationMs } from './processing-duration'

export function LiveProcessingDuration({
  startedAt,
  baseMs = 0,
  active = true
}: {
  startedAt?: number
  baseMs?: number
  /** 会话隐藏（切换对话）时暂停计时，避免隐藏列表每秒重渲染。 */
  active?: boolean
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  const [mountedAt] = useState(() => Date.now())
  const since = Math.min(startedAt ?? mountedAt, mountedAt)
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [active])
  // 恢复活跃时立刻校准一次，避免暂停期间的时长显示滞后。
  useEffect(() => {
    if (active) setNow(Date.now())
  }, [active, since])
  return <>{formatProcessingDurationMs(baseMs + Math.max(0, now - since))}</>
}
