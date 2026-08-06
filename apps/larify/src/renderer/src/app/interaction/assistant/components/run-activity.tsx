import { BanIcon, CircleCheckBigIcon, CircleDashedIcon, CircleXIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

export const formatRunDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const clock = [minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
  return hours > 0 ? `${hours}:${clock}` : clock
}

export function RunActivity({
  active,
  cancelled,
  failed
}: {
  active: boolean
  cancelled: boolean
  failed: boolean
}): React.JSX.Element | null {
  const startedAtRef = useRef<number | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [hasRun, setHasRun] = useState(false)

  useEffect(() => {
    if (!active) {
      if (startedAtRef.current !== null) {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000))
        startedAtRef.current = null
      }
      return
    }

    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now()
      setElapsedSeconds(0)
      setHasRun(true)
    }
    const update = (): void => {
      setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current!) / 1000))
    }
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [active])

  if (!hasRun) return null
  const icon = active ? (
    <CircleDashedIcon className="size-4 animate-spin" data-testid="run-active" />
  ) : cancelled ? (
    <BanIcon className="size-4" data-testid="run-cancelled" />
  ) : failed ? (
    <CircleXIcon className="size-4" data-testid="run-failed" />
  ) : (
    <CircleCheckBigIcon className="size-4" data-testid="run-completed" />
  )
  return (
    <motion.div
      layout="position"
      transition={{ layout: { duration: 0.05, ease: 'easeOut' } }}
      className="-mt-4 flex items-center gap-2 text-sm text-muted-foreground"
    >
      {icon}
      <span className="tabular-nums">{formatRunDuration(elapsedSeconds)}</span>
    </motion.div>
  )
}
