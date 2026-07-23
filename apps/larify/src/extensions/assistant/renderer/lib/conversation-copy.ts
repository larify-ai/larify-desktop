import { getToolName, isToolUIPart, type UIMessage } from "ai"
import { toolCall } from "./diff-meta"

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function conversationToText(messages: UIMessage[]): string {
  const blocks: string[] = []
  for (const message of messages) {
    const role =
      message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : message.role
    const lines: string[] = [`## ${role}`]
    for (const part of message.parts) {
      if (part.type === "text" && part.text) {
        lines.push(part.text)
      } else if (part.type === "reasoning" && part.text) {
        lines.push(`> [思考] ${part.text}`)
      } else if (isToolUIPart(part)) {
        const name = getToolName(part)
        const { title, args } = toolCall(part.input)
        lines.push(`### 🔧 ${name}${title ? `: ${title}` : ""}`)
        lines.push("输入:\n```json\n" + stringify(args) + "\n```")
        const out = part.state === "output-error" ? part.errorText : part.output
        if (out !== undefined && out !== null && out !== "") {
          lines.push("输出:\n```\n" + (typeof out === "string" ? out : stringify(out)) + "\n```")
        }
      }
    }
    if (lines.length > 1) blocks.push(lines.join("\n\n"))
  }
  return blocks.join("\n\n---\n\n")
}
