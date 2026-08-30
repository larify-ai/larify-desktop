// 两种目标形式共用同一段链接前缀（label + 括号 + 可选空格/尖括号）：
// 1) 尖括号形式：[f](<D:\a b.txt>) —— 目标可含空格/圆括号，以 > 结束。
// 2) 普通形式：[f](D:\a.txt) —— 目标在空白或 ) 处结束（不含 title 的常规路径）。
const linkPrefix = '(!?\\[[^\\]\\r\\n]*\\]\\(\\s*)'
const windowsMarkdownLink = new RegExp(
  `${linkPrefix}([a-z]:\\\\[^\\s\\r\\n)]*)(\\s*\\))`,
  'gi'
)
// 目标捕获组包含尖括号本身，替换时原样保留：`<...>` → 反斜杠转换。
const angleBracketedWindowsMarkdownLink = new RegExp(
  `${linkPrefix}(<[a-z]:\\\\[^>\\r\\n]*>)(\\s*\\))`,
  'gi'
)

function replaceWindowsSeparators(
  _match: string,
  prefix: string,
  destination: string,
  suffix: string
): string {
  return `${prefix}${destination.replaceAll('\\', '/')}${suffix}`
}

export function normalizeModelMarkdownLinks(markdown: string): string {
  return markdown
    .replace(angleBracketedWindowsMarkdownLink, replaceWindowsSeparators)
    .replace(windowsMarkdownLink, replaceWindowsSeparators)
}
