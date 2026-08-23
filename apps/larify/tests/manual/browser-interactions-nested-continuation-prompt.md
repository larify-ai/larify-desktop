## PROMPT

这是前一项无人值守回归的继续步骤。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

已有浏览器标签页 id=3，快照已经确认 Shadow Root input 是 `[ref=e7]`，iframe input 是 `[ref=e9]`。

1. browser_fill 对 `[ref=e7]` 输入 `shadow-ok`，用相同 ref 查询 value，必须严格匹配。
2. browser_type 对 `[ref=e9]` 以 clear=true 输入 `frame-ok`，用相同 ref 查询 value，必须严格匹配。
3. 用 browser_eval_js 在主文档创建 input `#shortcut` 并聚焦；browser_fill 输入 `before`，browser_press 执行 `Ctrl+A`，browser_keyboard_insert_text 插入 `shortcut-ok`，查询 value 必须严格匹配。
4. 关闭标签页 id=3，汇总三项结果。
