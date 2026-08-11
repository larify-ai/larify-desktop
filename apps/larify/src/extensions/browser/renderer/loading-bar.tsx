import { useNProgress } from '@tanem/react-nprogress'

export function LoadingBar({ loading }: { loading: boolean }): React.JSX.Element {
  const { isFinished, progress, animationDuration } = useNProgress({ isAnimating: loading })

  return (
    <div
      aria-hidden={isFinished}
      aria-label="正在加载"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5"
      role="progressbar"
      style={{ opacity: isFinished ? 0 : 1, transition: `opacity ${animationDuration}ms linear` }}
    >
      <div
        className="h-full bg-muted-foreground/35"
        style={{
          width: `${progress * 100}%`,
          transition: `width ${animationDuration}ms linear`
        }}
      />
    </div>
  )
}
