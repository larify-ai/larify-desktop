export interface DiffMeta {
  kind: "diff"
  path: string
  patch: string
}

export function asDiffMeta(output: unknown): DiffMeta | null {
  return output && typeof output === "object" && (output as DiffMeta).kind === "diff"
    ? (output as DiffMeta)
    : null
}

export function toolIcon(toolMetadata: unknown): string | undefined {
  const icon = (toolMetadata as { icon?: unknown } | null)?.icon
  return typeof icon === "string" ? icon : undefined
}

export function toolCall(input: unknown): { title?: string; args: unknown } {
  if (input && typeof input === "object" && "args" in input) {
    const { title, args } = input as { title?: unknown; args?: unknown }
    return { ...(typeof title === "string" && { title }), args }
  }
  return { args: input }
}
