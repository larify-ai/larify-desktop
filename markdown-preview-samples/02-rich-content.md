# 富文本能力

## 表格

| 功能     | 状态 | 说明                   |
| -------- | :--: | ---------------------- |
| GFM      |  ✅  | 表格、任务列表、删除线 |
| 代码高亮 |  ✅  | 由 CodeHighlighter 提供 |
| 数学公式 |  ✅  | 由 KaTeX 提供          |
| Mermaid  |  ✅  | 可视化流程图           |

## 代码

```ts
type PreviewMode = "preview" | "source";

const defaultMode = (kind: "markdown" | "html"): PreviewMode =>
  kind === "markdown" ? "preview" : "source";
```

## 数学公式

行内公式：$E = mc^2$

块级公式：

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## Mermaid

```mermaid
flowchart LR
  A["打开 Markdown"] --> B["剥离 YAML Frontmatter"]
  B --> C["XMarkdown 渲染"]
  C --> D["阅读视图"]
```

## 链接

- 普通相对链接：[基础示例](./01-basic.md)
- Obsidian WikiLink：[[01-basic|基础示例]]
- 外部链接：[Ant Design X](https://x.ant.design/x-markdowns/introduce)
