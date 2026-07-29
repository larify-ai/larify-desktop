export interface DiffMeta {
  kind: "diff"
  path: string
  patch: string
}

export function asDiffMeta(output: unknown): DiffMeta | null {
  if (!output || typeof output !== "object") return null
  const value = output as Partial<DiffMeta>
  return value.kind === "diff" &&
    typeof value.path === "string" &&
    typeof value.patch === "string"
    ? (value as DiffMeta)
    : null
}

export function toolIcon(toolMetadata: unknown): string | undefined {
  const icon = (toolMetadata as { icon?: unknown } | null)?.icon
  return typeof icon === "string" ? icon : undefined
}

export function toolCall(input: unknown): { title?: string; args: unknown } {
  if (input && typeof input === "object") {
    const { _title, ...args } = input as Record<string, unknown>
    return { ...(typeof _title === "string" && { title: _title }), args }
  }
  return { args: input }
}
