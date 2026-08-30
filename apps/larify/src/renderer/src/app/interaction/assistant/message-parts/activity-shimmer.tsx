import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@renderer/lib/utils'

const codexStepEasing = (progress: number): number => Math.floor(progress * 48) / 48

// 扫光带 = 前景×背景中间调：两主题对称可见（纯色极值受前景 alpha 不对称影响，
// 完全擦除成背景色在浅色下又太突兀），详见记忆 activity-shimmer。
const bandColor = 'color-mix(in srgb, var(--foreground) 30%, var(--background))'

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
        backgroundImage: `linear-gradient(90deg, transparent 0%, ${bandColor} 40%, ${bandColor} 60%, transparent 100%), linear-gradient(var(--foreground), var(--foreground))`,
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
