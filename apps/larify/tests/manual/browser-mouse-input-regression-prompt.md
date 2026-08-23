## PROMPT

这是 input.ts 鼠标能力的无人值守真实回归。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。
2. browser_click 点击 `#increment`，查询 `#count` text 必须等于 `1`。
3. browser_element_action hover `#increment`，browser_eval_js 验证 `document.querySelector('#increment').matches(':hover')` 为 true。
4. browser_query_element 查询 `#increment` 的 box，使用中心坐标依次调用 browser_mouse_move、browser_mouse_button left down、left up，再查询 `#count` 必须等于 `2`。
5. browser_eval_js 在 document 捕获阶段记录 mousedown/mouseup 的 button；在页面空白坐标分别执行 right down/up 和 middle down/up，验证事件记录包含 button=2 和 button=1 的 down/up。
6. 记录初始 scrollY，browser_mouse_wheel dy=600，browser_eval_js 验证 scrollY 大于初始值。
7. 关闭标签页，汇总 click、hover、raw left、right、middle、wheel 结果。
