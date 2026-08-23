## PROMPT

这是 interactions 输入链路的无人值守真实回归测试。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。
2. 用 browser_eval_js 在主文档创建：input `#main-input`、textarea `#main-textarea`、contenteditable div `#editable`；创建开放 Shadow Root，内部放 input；创建 iframe，srcdoc 内放 input。给所有输入元素记录 input、keydown、keyup 事件计数。
3. browser_fill 把 `#main-input` 填为 `填充✅`，验证 value 和 input 事件计数。
4. browser_type 以 clear=true、delayMs=1 把 `#main-textarea` 输入为下面代码块中的两行文本，代码块中间必须是真实换行，不是反斜杠加 n：

```text
A!
B
```

验证 value 严格等于 `A!`、LF、`B`；确认 Enter 产生 keydown/keyup，普通字符产生 input 事件即可（旧版普通字符使用 insertText，不要求 keydown/keyup）。
5. browser_fill 把 `#editable` 填为 `可编辑🙂`，验证 text。
6. 调用 browser_snapshot 获取完整页面树，从快照中找到 Shadow Root input 和 iframe input 的 ref。分别用 ref 执行 browser_fill 输入 `shadow-ok` 和 browser_type clear=true 输入 `frame-ok`，再使用相同 ref 查询 value，必须严格匹配。若快照没有对应 ref，如实记录失败，不改用页面脚本代替输入。
7. 聚焦 `#main-input`，调用 browser_press 执行 `Ctrl+A`，再调用 browser_keyboard_insert_text 插入 `shortcut-ok`，验证 value 严格等于 `shortcut-ok`。
8. 关闭标签页，逐项汇总主文档、contenteditable、Shadow DOM、iframe、Enter和快捷键结果。
