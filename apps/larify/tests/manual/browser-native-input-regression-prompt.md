# Browser WebView native input regression

## PROMPT

这是无人值守浏览器输入回归测试。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。依次执行并验证：

1. browser_fill 把 `#text` 填为 `fill-ok`，用 browser_query_element value 验证。
2. browser_type 使用 clear=true 把 `#text` 输入为 `type-ok`，再次验证。
3. browser_fill 清空 `#text`，browser_element_action focus `#text`，browser_keyboard_type 输入 `abc` 并验证；然后 browser_keyboard_key 依次执行 Control down、A down、A up、Control up，browser_keyboard_insert_text 插入 `native-ok`，验证最终 value 必须严格等于 `native-ok`。
4. 关闭标签页。最终汇总四次 value 验证结果。
