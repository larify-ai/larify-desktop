export function previewErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  return /\bENOENT\b/.test(message) ? '文件不存在' : message
}
