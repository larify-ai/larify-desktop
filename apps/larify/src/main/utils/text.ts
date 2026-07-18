export const splitLines = (text: string): string[] => text.split(/\r\n|\n|\r/)

export const trimTrailingLineBreak = (text: string): string => {
  if (text.endsWith("\r\n")) return text.slice(0, -2)
  if (text.endsWith("\n") || text.endsWith("\r")) return text.slice(0, -1)
  return text
}
