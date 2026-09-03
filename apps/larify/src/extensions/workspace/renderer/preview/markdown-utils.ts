// 仅作「剥离头部」用，不调用 js-yaml，故对非法 YAML（如未加引号的
// `Failed to parse URL:`）也不抛异常。行为对齐 front-matter 包：只剥「文档最顶部」
// 的 frontmatter，且即便 YAML 解析失败（闭合块仍在）也照剥，避免 name/description 泄露。
//
// 实现要点（比直接依赖 `front-matter` 更可控）：
// 1. `(?<![\s\S])` 等价 `\A`，把匹配锚定到字符串开头——front-matter 原本靠 `lines[0]`
//    首行守卫实现这一点，这里内联进正则，避免误删文档中段出现的 `---` 水平分隔线。
// 2. 换行边界用 `(?:\r\n?|\n)` 显式覆盖 LF / CRLF / 单独 CR 三种结尾，不依赖 JS 正则
//    `m` 标志下 `$` 对 `\r` 的怪异判定（在纯 CR 文档里 `$` 不把 `\r` 视作行尾，会导致
//    跨行误匹配）。因此不再使用 `m` 标志。
// body 与闭合分隔符之间的换行设为可选：`---\n---\n` 这类空 frontmatter 也能正确剥离
// （对齐 front-matter 原行为），同时非空 frontmatter 的换行仍正常匹配。
export const YAML_FRONTMATTER_RE =
  /(?<![\s\S])(\ufeff?(= yaml =|---)(?:\r\n?|\n)([\s\S]*?)(?:\r\n?|\n)?(?:\2|\.\.\.)\s*(?:\r\n?|\n)?)/

export function stripYamlFrontmatter(markdown: string): string {
  // 只要「首行是 `---`（或 `= yaml =`）且存在闭合 `---`/`...`」即视为
  // frontmatter 块并剥离。不依赖 YAML 是否解析成功：当 frontmatter 值含
  // 未加引号的 `: `（如 `Failed to parse URL: ERR_INVALID_URL`）时，js-yaml
  // 会解析失败，但闭合块依然存在，此时仍应剥离，避免 name/description 泄露。
  const match = markdown.match(YAML_FRONTMATTER_RE)
  if (!match) return markdown
  return markdown.slice(match[0].length)
}
