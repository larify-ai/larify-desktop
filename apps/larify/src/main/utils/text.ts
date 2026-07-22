export const splitLines = (text: string): string[] => text.split(/\r\n|\n|\r/)

export const normalizeLineBreaks = (text: string): string => text.replace(/\r\n?/g, "\n")

export const applyLineBreaks = (text: string, lineBreak: string): string =>
  lineBreak === "\n" ? text : text.replaceAll("\n", lineBreak)

export const dominantLineBreak = (text: string): string => {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  return crlf > lf ? "\r\n" : "\n"
}

export const trimTrailingLineBreak = (text: string): string => text.replace(/[\r\n]+$/, "")

export const normalizeTerminalInputLineBreaks = (text: string): string =>
  text.replace(/\r\n|\n\r|\n|\r/g, "\r")
