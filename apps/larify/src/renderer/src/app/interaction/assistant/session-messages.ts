import type { UIMessage } from 'ai'

export const messagePageSize = 50

export interface MessagePage {
  messages: UIMessage[]
  messageCount: number
}

export interface SessionNavigationItem {
  id: string
  index: number
  promptPreview: string
  responsePreview?: string
}

export async function loadSessionNavigation(
  id: string,
  beforeIndex?: number,
  limit = 50
): Promise<SessionNavigationItem[]> {
  const value = await window.bridge.invoke('session:navigation', id, beforeIndex, limit)
  if (!Array.isArray(value)) return []
  return value.filter((item): item is SessionNavigationItem =>
    Boolean(
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      Number.isSafeInteger(item.index) &&
      typeof item.promptPreview === 'string' &&
      (item.responsePreview === undefined || typeof item.responsePreview === 'string')
    )
  )
}

export async function loadMessagePage(id: string): Promise<MessagePage> {
  const value = await window.bridge.invoke('session:msg-count', id)
  const messageCount = validMessageCount(value)
  if (!messageCount) return { messages: [], messageCount }
  const messages = await loadVisibleMessages(
    id,
    Math.max(0, messageCount - messagePageSize),
    messagePageSize
  )
  return { messages, messageCount }
}

export async function loadVisibleMessages(
  id: string,
  offset: number,
  limit: number
): Promise<UIMessage[]> {
  const value = await window.bridge.invoke('session:msgs', id, offset, limit)
  return loadAttachments(Array.isArray(value) ? (value as UIMessage[]) : [])
}

async function loadAttachments(messages: UIMessage[]): Promise<UIMessage[]> {
  if (!messages.length) return messages
  try {
    const loaded = await window.bridge.invoke('attachment:load', messages)
    return Array.isArray(loaded) ? (loaded as UIMessage[]) : messages
  } catch {
    return messages
  }
}

function validMessageCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
