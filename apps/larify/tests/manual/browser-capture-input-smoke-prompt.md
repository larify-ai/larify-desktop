# browser 采集与底层输入冒烟测试 Prompt

## PROMPT

你正在测试 `browser` 的截图、PDF、录屏、键盘和鼠标工具。

先用 `fs.write` 创建 `browser-smoke/input.html`：包含标题、输入框 `#input`、按钮 `#button`、计数文本 `#count`；按钮点击时计数加一；页面高度至少 2000px。用 `create_tab` 打开并保存 id。

每一步先写预期，调用后写实际和 ✅/❌。

### 1. 截图与 PDF

- `screenshot` 截取视口到 `browser-smoke/viewport.png`。
- `screenshot` 设置 `fullPage=true` 保存 `browser-smoke/full-page.jpeg`，format=`jpeg`、quality=80。
- `screenshot` 截取 `#button` 到 `browser-smoke/button.png`。
- `pdf` 保存到 `browser-smoke/page.pdf`。

每步预期返回正 bytes；用 `fs.ls` 或 `fs.read` 能确认文件存在且非空。

### 2. 键盘输入

先用 `element_action` focus `#input`：

- `keyboard_type` 输入 `abc`。
- `keyboard_key` 依次执行 Control down、A down、A up、Control up。
- `keyboard_insert_text` 插入 `replaced`。
- 用 `query_element` value 检查最终值；如果平台的全选行为不同，贴出实际值。

### 3. 鼠标输入

- 用 `query_element` box 获取 `#button` 坐标。
- `mouse_move` 到按钮中心。
- `mouse_button` left down，再 left up。
- 读取 `#count`，预期为 `1`。
- `mouse_wheel` dy=500，预期成功且页面发生向下滚动；可用 `eval_js` 读取 `scrollY` 验证。

### 4. 录屏

1. `record_start` 保存到 `browser-smoke/recording.webm`。
2. 点击按钮并滚动。
3. `record_stop`，预期文件存在且 bytes 大于 0。
4. `record_restart` 保存到 `browser-smoke/restarted.webm`，执行一次点击，再 `record_stop`。
5. 空闲状态再次 `record_stop`，预期返回 `no recording in progress` 错误。
6. 再用 `record_start`，传 `duration=2` 保存 `browser-smoke/timed.webm`，预期自动停止并生成文件。

最后使用 `close_tab` 关闭标签页，输出汇总表和生成文件路径。
