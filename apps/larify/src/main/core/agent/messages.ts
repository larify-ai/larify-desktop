import {
  convertToModelMessages,
  safeValidateUIMessages,
  type ModelMessage,
  type UIMessage
} from 'ai'

type MessagePart = UIMessage['parts'][number]
type ToolPart = MessagePart & { state?: string }

function isToolPart(part: MessagePart): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-')
}

function isComplete(part: MessagePart): boolean {
  const state = (part as ToolPart).state
  return state === 'output-available' || state === 'output-error' || state === 'output-denied'
}

function sanitizeMessage(message: UIMessage): UIMessage | undefined {
  if (message.role !== 'assistant') return message
  const parts = message.parts.filter((part) => !isToolPart(part) || isComplete(part))
  return parts.length ? { ...message, parts } : undefined
}

async function validateMessage(message: UIMessage): Promise<UIMessage | undefined> {
  const result = await safeValidateUIMessages<UIMessage>({ messages: [message] })
  return result.success ? result.data[0] : undefined
}

function replaceFilesWithPaths(message: UIMessage): UIMessage {
  if (message.role !== 'user') return message

  const paths = message.parts.filter((part) => part.type === 'file').map((part) => part.url)
  if (!paths.length) return message

  return {
    ...message,
    parts: [
      {
        type: 'text',
        text: `Attached paths:\n${paths.map((path) => `- ${path}`).join('\n')}\n\n`
      },
      ...message.parts.filter((part) => part.type !== 'file')
    ]
  }
}

export function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => sanitizeMessage(message) ?? [])
}

export async function prepareMessages(messages: UIMessage[]): Promise<UIMessage[]> {
  const sanitized = sanitizeMessages(messages)
  const result = await safeValidateUIMessages<UIMessage>({ messages: sanitized })
  if (result.success) return result.data

  const valid: UIMessage[] = []
  for (const message of sanitized) {
    const validated = await validateMessage(message)
    if (validated) valid.push(validated)
  }
  return valid
}

export function toModelMessages(messages: UIMessage[]): Promise<ModelMessage[]> {
  return convertToModelMessages(messages.map(replaceFilesWithPaths))
}
