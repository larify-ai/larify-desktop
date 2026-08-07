import type { UIMessage } from 'ai'
import type { SessionStore } from './store'

function deriveTitle(messages: UIMessage[]): string {
  return (
    messages
      .find(({ role }) => role === 'user')
      ?.parts.find((part) => part.type === 'text')
      ?.text.trim() || 'Untitled'
  )
}

export function saveSessionMessages(
  store: SessionStore,
  id: string,
  cwd: string,
  messages: UIMessage[],
  title?: string
): void {
  store.createSession({ id, cwd, title: title ?? deriveTitle(messages) })
  store.saveMessages(id, messages)
}
