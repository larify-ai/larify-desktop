import { parsePatch } from 'diff'

export const roundChangedLines = (
  patch: string
): Array<{ kind: 'added' | 'deleted'; line: number }> => {
  const changes: Array<{ kind: 'added' | 'deleted'; line: number }> = []
  for (const file of parsePatch(patch)) {
    for (const hunk of file.hunks) {
      let line = hunk.newStart
      let deleted = false
      let added = false
      for (const content of hunk.lines) {
        if (content.startsWith('+')) {
          changes.push({ kind: 'added', line })
          added = true
          line += 1
        } else if (content.startsWith('-')) {
          deleted = true
        } else {
          line += 1
        }
      }
      if (deleted && !added) changes.push({ kind: 'deleted', line: hunk.newStart })
    }
  }
  return changes
}
