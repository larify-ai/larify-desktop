import { safeValidateUIMessages, type UIMessage } from "ai"

type ToolState = {
  state?: string
  type?: string
}

const isToolPart = (part: UIMessage["parts"][number]): boolean => {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-")
}

const isCompleteToolPart = (part: UIMessage["parts"][number]): boolean => {
  const state = (part as ToolState).state
  return state === "output-available" || state === "output-error" || state === "output-denied"
}

export function sanitizeMessages(messages: UIMessage[]): UIMessage[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") return [message]

    const parts = message.parts.filter((part) => !isToolPart(part) || isCompleteToolPart(part))
    if (parts.length === 0) return []
    return [{ ...message, parts }]
  })
}

export async function sanitizeAndValidateMessages(messages: UIMessage[]): Promise<UIMessage[]> {
  const sanitized = sanitizeMessages(messages)
  const result = await safeValidateUIMessages<UIMessage>({ messages: sanitized })
  if (result.success) return result.data

  const validMessages: UIMessage[] = []
  for (const message of sanitized) {
    const single = await safeValidateUIMessages<UIMessage>({ messages: [message] })
    if (single.success) validMessages.push(single.data[0])
  }
  return validMessages
}
