# 长文滚动测试

这个文件用于确认顶部模式工具栏不覆盖内容，并且正文区域可以独立滚动。

## 第一章

Markdown 的阅读视图应该保持适中的正文宽度，使长段落更容易阅读。工具栏占用独立的一行，因此无论滚动到哪里，正文都不会被切换按钮遮挡。

> [!NOTE]
> 这段使用了 Obsidian Callout 写法。当前若按普通引用显示是预期行为，后续可以再增加 Callout 扩展。

## 第二章

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

## 第三章

### 小节 A

这是一段用于制造页面高度的内容。切换到源码模式后，应显示完整 Markdown，包括标题符号和引用标记。

### 小节 B

- Alpha
- Beta
- Gamma
- Delta
- Epsilon

## 第四章

```json
{
  "markdownDefault": "preview",
  "htmlDefault": "source",
  "frontmatter": "hidden-in-preview"
}
```

## 结尾

如果能够滚动到这里，并始终可以使用顶部的“阅读 / 源码”按钮，则布局行为正确。
