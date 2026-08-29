import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  MessageAction,
  MessageActions,
  MessageContent
} from '@renderer/components/ai-elements/message'

export function UserMessageContent({
  children,
  text
}: {
  children: ReactNode
  text: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    },
    []
  )

  const copyText = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(false), 1_500)
  }

  return (
    <div className="group/bubble ml-auto w-fit max-w-full">
      <MessageContent className="select-text break-words [overflow-wrap:anywhere] [&_.larify-message-markdown]:space-y-0">
        <div className="relative max-h-[3.75rem] overflow-hidden">
          {children}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-[2.5rem] h-5 bg-gradient-to-b from-transparent to-secondary"
          />
        </div>
      </MessageContent>
      <MessageActions className="invisible mt-1 justify-end opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover/bubble:visible group-hover/bubble:opacity-100">
        <MessageAction title="复制" label="复制" onClick={() => void copyText()}>
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </MessageAction>
      </MessageActions>
    </div>
  )
}
