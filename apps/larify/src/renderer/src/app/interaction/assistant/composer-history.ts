import { useRef, type ChangeEvent, type KeyboardEvent } from 'react'

interface ComposerHistory {
  reset: () => void
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
}

export function useComposerHistory(
  history: string[],
  setValue: (value: string) => void
): ComposerHistory {
  const index = useRef<number | null>(null)
  const draft = useRef('')

  const reset = (): void => {
    index.current = null
    draft.current = ''
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    reset()
    setValue(event.target.value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.currentTarget.selectionStart !== event.currentTarget.selectionEnd) return

    const textarea = event.currentTarget
    const select = (next: string, position: number): void => {
      setValue(next)
      requestAnimationFrame(() => textarea.setSelectionRange(position, position))
    }

    if (
      event.key === 'ArrowUp' &&
      !textarea.value.slice(0, textarea.selectionStart).includes('\n')
    ) {
      if (!history.length) return
      event.preventDefault()
      if (index.current === null) draft.current = textarea.value
      index.current = Math.max(0, Math.min(index.current ?? history.length, history.length) - 1)
      const next = history[index.current]
      select(next, 0)
      return
    }

    if (
      event.key === 'ArrowDown' &&
      index.current !== null &&
      !textarea.value.slice(textarea.selectionEnd).includes('\n')
    ) {
      event.preventDefault()
      index.current += 1
      if (index.current < history.length) {
        const next = history[index.current]
        select(next, next.length)
      } else {
        const next = draft.current
        reset()
        select(next, next.length)
      }
    }
  }

  return { reset, onChange, onKeyDown }
}
