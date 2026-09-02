import { useEffect } from 'react'
import { ArrowLeftIcon, ArrowRightIcon } from 'lucide-react'
import { useAssistantSessions } from '../interaction/assistant/sessions-context'

export function NavigationHistory(): React.JSX.Element {
  const { back, forward, canBack, canForward } = useAssistantSessions()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.shiftKey || event.metaKey || event.ctrlKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        back()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [back, forward])

  const buttonClassName =
    'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,opacity] hover:bg-sidebar-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 [-webkit-app-region:no-drag]'

  return (
    <div className="-ml-2 flex shrink-0 items-center">
      <button
        type="button"
        aria-label="后退"
        title="后退 (Alt+←)"
        disabled={!canBack}
        className={buttonClassName}
        onClick={back}
      >
        <ArrowLeftIcon aria-hidden="true" className="pointer-events-none size-[18px]" />
      </button>
      <button
        type="button"
        aria-label="前进"
        title="前进 (Alt+→)"
        disabled={!canForward}
        className={buttonClassName}
        onClick={forward}
      >
        <ArrowRightIcon aria-hidden="true" className="pointer-events-none size-[18px]" />
      </button>
    </div>
  )
}
