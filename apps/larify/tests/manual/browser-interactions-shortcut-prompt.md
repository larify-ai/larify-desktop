## PROMPT

这是 interactions 快捷键的无人值守回归。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\nested-input.html`。
2. browser_fill 把 `#shortcut` 填为 `before`。
3. browser_press 对当前焦点执行 `Ctrl+A`，browser_keyboard_insert_text 插入 `shortcut-ok`。
4. browser_query_element 查询 `#shortcut` 的 value，必须严格等于 `shortcut-ok`。
5. 关闭标签页并报告实际 value。
