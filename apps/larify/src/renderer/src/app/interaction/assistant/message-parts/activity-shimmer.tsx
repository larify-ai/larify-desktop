import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@renderer/lib/utils'

const codexStepEasing = (progress: number): number => Math.floor(progress * 48) / 48

export function ActivityShimmer({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  if (reduceMotion) return <span className={cn('inline-flex', className)}>{children}</span>

  return (
    <motion.span
      className={cn('inline-flex text-transparent', className)}
      data-shimmer-content
      initial={{ backgroundPosition: '-100% 0, 0 0' }}
      animate={{ backgroundPosition: '250% 0, 0 0' }}
      style={{
        backgroundImage:
          'linear-gradient(90deg, transparent 0%, var(--background) 40%, var(--background) 60%, transparent 100%), linear-gradient(var(--foreground), var(--foreground))',
        backgroundRepeat: 'no-repeat',
        backgroundSize: '50% 200%, 100% 100%',
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent'
      }}
      transition={{ duration: 2, ease: codexStepEasing, repeat: Number.POSITIVE_INFINITY }}
    >
      {children}
    </motion.span>
  )
}
