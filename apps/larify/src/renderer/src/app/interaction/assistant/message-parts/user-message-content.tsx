import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MessageContent } from '@renderer/components/ai-elements/message'

export function UserMessageContent({ children }: { children: ReactNode }): React.JSX.Element {
  const contentRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content || expanded) return

    const measure = (): void => setOverflowing(content.scrollHeight > content.clientHeight + 1)
    measure()

    const observer = new ResizeObserver(measure)
    observer.observe(content)
    return () => observer.disconnect()
  }, [children, expanded])

  return (
    <div className="ml-auto w-fit max-w-full">
      <MessageContent className="select-text break-words [overflow-wrap:anywhere]">
        <div ref={contentRef} className={expanded ? undefined : 'max-h-[3.75rem] overflow-hidden'}>
          {children}
        </div>
      </MessageContent>
      {overflowing ? (
        <button
          type="button"
          aria-label={expanded ? '收起消息' : '展开消息'}
          aria-expanded={expanded}
          className="mt-1 ml-auto flex w-fit items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? '收起' : '展开'}
          {expanded ? (
            <ChevronUpIcon className="size-3.5" />
          ) : (
            <ChevronDownIcon className="size-3.5" />
          )}
        </button>
      ) : null}
    </div>
  )
}
