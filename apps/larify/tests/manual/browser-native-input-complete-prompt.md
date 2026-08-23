## PROMPT

这是隐藏 WebView 原生键盘输入的无人值守回归测试。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`，记住标签页 id。
2. 用 browser_eval_js 在页面中创建 textarea `#native-input` 和 button `#after-input`，并在 textarea 上监听 keydown、keyup、input，把每个事件的 type、key、ctrlKey、metaKey、shiftKey 追加到 `window.__nativeEvents`。
3. 聚焦 `#native-input`，用 browser_keyboard_type 输入 `aA!中🙂`，查询 value，必须严格等于 `aA!中🙂`；同时用 browser_eval_js 读取事件数组，确认 a、A、! 至少产生 keydown 和 keyup，A 和 ! 的 keydown 带 shiftKey=true。
4. 用 browser_keyboard_key 按下并抬起 Enter，查询 value，必须严格等于 `aA!中🙂\n`。
5. 用 browser_keyboard_key 按下并抬起 Tab，用 browser_eval_js 查询 `document.activeElement.id`，必须等于 `after-input`。
6. 重新聚焦 textarea，用 browser_keyboard_key 依次 Control down、A down、A up、Control up，再用 browser_keyboard_insert_text 插入 `替换✅`，查询 value，必须严格等于 `替换✅`。
7. 清空并重新聚焦 textarea；Control down 后调用 browser_keyboard_type 输入 `b`，再 Control up。查询 value，必须仍为空，并确认事件中存在 ctrlKey=true 的 b keydown，证明快捷键不会额外插入字符。
8. 关闭标签页。最终逐项报告实际值和事件验证结果。
