import { useEffect, useMemo, useRef, useState } from 'react'
import { isToolUIPart, type UIMessage } from 'ai'
import { useReducedMotion } from 'motion/react'
import { MessageMarkdown } from './message-markdown'
import { ReasoningPart } from './reasoning-part'
import { ToolPart } from './tool-part'

type Part = UIMessage['parts'][number]

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function ReplayedText({
  text,
  onComplete
}: {
  text: string
  onComplete?: () => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion()
  const segments = useMemo(
    () => [...graphemeSegmenter.segment(text)].map(({ segment }) => segment),
    [text]
  )
  const [visible, setVisible] = useState(reduceMotion ? segments.length : 0)
  const completed = useRef(false)

  useEffect(() => {
    completed.current = false
    if (reduceMotion || segments.length === 0) {
      setVisible(segments.length)
      completed.current = true
      onComplete?.()
      return
    }
    setVisible(0)
    const duration = Math.min(1_400, Math.max(700, segments.length * 24))
    const tick = 24
    const startedAt = performance.now()
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt
      const next = Math.min(
        segments.length,
        Math.max(1, Math.ceil((segments.length * elapsed) / duration))
      )
      setVisible((current) => Math.max(current, next))
      if (next === segments.length && !completed.current) {
        completed.current = true
        clearInterval(timer)
        onComplete?.()
      }
    }, tick)
    return () => clearInterval(timer)
  }, [onComplete, reduceMotion, segments])

  return (
    <div data-final-answer-replay>
      <MessageMarkdown isAnimating={visible < segments.length}>
        {segments.slice(0, visible).join('')}
      </MessageMarkdown>
    </div>
  )
}

export function MessagePart({
  part,
  streaming,
  replay = false,
  onReplayComplete
}: {
  part: Part
  streaming: boolean
  replay?: boolean
  onReplayComplete?: () => void
}): React.JSX.Element | null {
  if (part.type === 'text') {
    if (replay) return <ReplayedText text={part.text} onComplete={onReplayComplete} />
    const isStreaming = part.state === 'streaming' || (part.state === undefined && streaming)
    return part.text ? (
      <MessageMarkdown isAnimating={isStreaming}>{part.text}</MessageMarkdown>
    ) : null
  }
  if (part.type === 'reasoning') return <ReasoningPart part={part} streaming={streaming} />
  if (isToolUIPart(part)) return <ToolPart part={part} />
  return null
}
