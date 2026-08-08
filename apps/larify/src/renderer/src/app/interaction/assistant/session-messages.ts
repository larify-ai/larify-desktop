import type { UIMessage } from 'ai'

const pageSize = 50

export interface MessagePage {
  messages: UIMessage[]
  hasMore: boolean
}

export async function loadMessagePage(id: string, offset = 0): Promise<MessagePage> {
  const value = await window.bridge.invoke('session:msgs', id, offset, pageSize + 1)
  const stored = Array.isArray(value) ? (value as UIMessage[]) : []
  const hasMore = stored.length > pageSize
  const messages = hasMore ? stored.slice(1) : stored
  if (!messages.length) return { messages, hasMore }

  const loaded = await window.bridge.invoke('attachment:load', messages)
  return {
    messages: Array.isArray(loaded) ? (loaded as UIMessage[]) : messages,
    hasMore
  }
}
