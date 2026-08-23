## PROMPT

这是隐藏 WebView 键盘输入的穷举回归测试。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。
2. 用 browser_eval_js 创建并聚焦 textarea `#all-keys`，在 document 捕获阶段监听 keydown、keyup、input，把 key、shiftKey、ctrlKey、altKey、metaKey 记录到 `window.__keyEvents`，确保 Tab 改变焦点后仍能观察 keyup。
3. 用一次 browser_keyboard_type 输入下面代码块内从空格到波浪号的全部 95 个 ASCII 可打印字符，代码块首字符是一个空格，不能增删或改写：

```text
 !"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~
```

再用 browser_keyboard_type 输入 `中文🙂éΩ`。用 browser_eval_js 构造相同的预期字符串并与 textarea.value 严格比较，必须完全一致、ASCII 部分长度必须为 95。
4. 用 browser_eval_js 检查 ASCII 键盘事件：全部 95 个字符都有 keydown 和 keyup；`ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:"<>?` 的 keydown 必须 shiftKey=true，其余 ASCII keydown 必须 shiftKey=false。Unicode 字符允许只有 input 事件。
5. 清空事件数组并保持 textarea 聚焦。对下面每个受支持命名键各调用一次 browser_keyboard_key down 和一次 up：`Alt`、`Control`、`Meta`、`Shift`、`Enter`、`Tab`、`Escape`、`Backspace`、`Delete`、`ArrowUp`、`ArrowDown`、`ArrowLeft`、`ArrowRight`、`Home`、`End`、`PageUp`、`PageDown`、`Space`。每次 Tab 后重新聚焦 textarea，再继续后面的键。
6. 用 browser_eval_js 验证上述 18 个命名键都至少各产生一次对应 key 的 keydown 和 keyup；Enter 的 key 值为 `Enter`，Space 的 key 值为单个空格。报告缺失列表，必须为空。
7. 关闭标签页，汇总 ASCII 精确匹配、Shift 分类、Unicode、命名键覆盖结果。
