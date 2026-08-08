import type { UIMessage } from 'ai'

const pageSize = 50

export interface MessagePage {
  messages: UIMessage[]
  hasMore: boolean
}

export async function loadMessagePage(id: string, offset = 0): Promise<MessagePage> {
  const value = await window.bridge.invoke('session:msgs', id, offset, pageSize + 1)
  const stored = Array.isArray(value) ? (value as UIMessage[]) : []
  const valueWithAttachments = await window.bridge.invoke('attachment:load', stored)
  const messages = Array.isArray(valueWithAttachments)
    ? (valueWithAttachments as UIMessage[])
    : stored
  return {
    messages: messages.length > pageSize ? messages.slice(1) : messages,
    hasMore: messages.length > pageSize
  }
}
