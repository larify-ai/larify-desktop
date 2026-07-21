import { getToolName, isToolUIPart, type UIMessage } from "ai"

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
        const rawName = getToolName(part)
        const input = part.input as { name?: unknown; args?: unknown } | undefined
        const isCall =
          rawName === "call_tool" && input !== null && typeof input === "object"
        const name = isCall && typeof input?.name === "string" ? input.name : rawName
        const args = isCall && input && "args" in input ? input.args : part.input
        lines.push(`### 🔧 ${name}`)
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
