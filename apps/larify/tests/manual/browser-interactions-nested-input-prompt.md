## PROMPT

这是 interactions 嵌套输入的无人值守短回归。必须实际调用 browser 工具，不要调用 ask_user，不要重试。

1. 用 browser_create_tab 打开 `D:\Workspace\larify-desktop\apps\larify\tests\extensions\browser\fixtures\interaction.html`。
2. 用 browser_eval_js 创建 contenteditable `#editable`、开放 Shadow Root 内的 input，以及 iframe srcdoc 内的 input；等待 iframe input 存在。
3. browser_fill 把 `#editable` 填为 `可编辑🙂`，验证 text 严格匹配。
4. browser_snapshot 获取完整页面树，找到 Shadow Root input 和 iframe input 的 ref。分别用 ref 执行 browser_fill 输入 `shadow-ok` 和 browser_type clear=true 输入 `frame-ok`，再使用相同 ref 查询 value。不得用 eval_js 代替这些输入和查询；没有 ref 就记录失败。
5. 在主文档创建 input `#shortcut` 并聚焦，browser_fill 输入 `before`，browser_press 执行 `Ctrl+A`，browser_keyboard_insert_text 插入 `shortcut-ok`，验证 value 严格匹配。
6. 关闭标签页，汇总 contenteditable、Shadow DOM、iframe、快捷键结果。
