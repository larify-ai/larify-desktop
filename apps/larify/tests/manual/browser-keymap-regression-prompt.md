## PROMPT

这是 keymap 真实 WebView/CDP 回归测试。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。
2. 用 browser_eval_js 创建并聚焦 textarea `#keymap-input`，在 document 捕获阶段记录 keydown/keyup 的 key、code、shiftKey、ctrlKey 到 `window.__keymapEvents`。
3. 用 browser_keyboard_key 对 `A` 执行 down、up，再对 `!` 执行 down、up。验证 textarea.value 严格等于 `A!`，并验证 A、! 的 down/up 都是 shiftKey=true。
4. 清空 textarea 并聚焦。分别调用 browser_press 输入 `A` 和 `!`，验证 value 严格等于 `A!`，对应事件 shiftKey=true。
5. 调用 browser_press 执行 `Ctrl+A`，再用 browser_keyboard_insert_text 插入 `selected`，验证 value 严格等于 `selected`，证明组合键解析正确。
6. 清空事件数组，调用 browser_press 执行 `Ctrl++`。验证至少存在一个 key=`+`、ctrlKey=true、shiftKey=true 的 keydown 和 keyup，证明加号快捷键解析正确。
7. 关闭标签页，汇总所有实际值和事件结果。
