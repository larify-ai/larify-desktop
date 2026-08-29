export function formatProcessingDurationMs(totalMs: number): string {
  let remaining = Math.max(0, Math.ceil(totalMs / 1_000))
  const days = Math.floor(remaining / 86_400)
  remaining %= 86_400
  const hours = Math.floor(remaining / 3_600)
  remaining %= 3_600
  const minutes = Math.floor(remaining / 60)
  const seconds = remaining % 60
  const parts = [
    days ? `${days}天` : '',
    days || hours ? `${hours}小时` : '',
    days || hours || minutes ? `${minutes}分钟` : '',
    `${seconds}秒`
  ].filter(Boolean)
  return `处理了 ${parts.join(' ')}`
}

export function formatProcessingDuration(startedAt: number, currentAt: number): string {
  return formatProcessingDurationMs(currentAt - startedAt)
}
