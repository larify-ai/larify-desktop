import {
  convertToModelMessages,
  isToolUIPart,
  safeValidateUIMessages,
  type ModelMessage,
  type ToolSet,
  type UIMessage
} from 'ai'

type MessagePart = UIMessage['parts'][number]

function shouldKeepPart(part: MessagePart, keepPendingAskUser: boolean): boolean {
  if (!isToolUIPart(part)) return true
  if (
    keepPendingAskUser &&
    part.state === 'input-available' &&
    (part.type === 'tool-agent_ask_user' ||
      (part.type === 'dynamic-tool' && part.toolName === 'agent_ask_user'))
  ) {
    return true
  }
  return (
    part.state === 'output-available' ||
    part.state === 'output-error' ||
    part.state === 'output-denied'
  )
}

function sanitizeMessage(message: UIMessage, keepPendingAskUser: boolean): UIMessage | undefined {
  if (message.role !== 'assistant') return message
  const parts = message.parts.filter((part) => shouldKeepPart(part, keepPendingAskUser))
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
  return messages.flatMap(
    (message, index) => sanitizeMessage(message, index === messages.length - 1) ?? []
  )
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

export function toModelMessages(
  messages: UIMessage[],
  tools: ToolSet = {}
): Promise<ModelMessage[]> {
  return convertToModelMessages(messages.map(replaceFilesWithPaths), { tools })
}
