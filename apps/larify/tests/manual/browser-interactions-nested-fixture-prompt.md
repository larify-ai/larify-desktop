## PROMPT

这是 interactions 嵌套输入的无人值守回归。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\nested-input.html`。
2. browser_fill 把 `#editable` 填为 `可编辑🙂`，查询 text 必须严格匹配。
3. browser_snapshot 获取完整页面树，从 accessible name 找到 `Shadow input` 和 `Frame input` 的 ref。用 browser_fill 对 Shadow ref 输入 `shadow-ok`，用 browser_type clear=true 对 Frame ref 输入 `frame-ok`，分别用相同 ref 查询 value，必须严格匹配；不得用 eval_js 代替。
4. browser_fill 把 `#shortcut` 填为 `before`，browser_press 执行 `Ctrl+A`，browser_keyboard_insert_text 插入 `shortcut-ok`，查询 value 必须严格匹配。
5. 关闭标签页，汇总四项结果。
