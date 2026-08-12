# browser 异常路径冒烟测试 Prompt

## PROMPT

你正在验收 `browser` 的异常处理。必须真实调用对应工具，不得用文字模拟，也不要用终端代替 Browser 工具。

先用 `fs.write` 创建 `browser-smoke/error-paths.html`，页面包含：

- 文件输入框 `#file`，选择后把文件名写到 `#file-name`。
- 普通文本输入框 `#text`。
- 链接 `#not-download`，点击只执行 `event.preventDefault()`，不会触发下载。

然后使用 `create_tab` 打开该本地页面，保存返回的标签页 id。每一步先写预期，再调用工具并报告真实结果。

1. `upload` 上传不存在的 `browser-smoke/missing-file.txt` 到 `#file`，预期明确报错，且页面不显示文件名。
2. `upload` 上传任意现有文件到非文件输入框 `#text`，预期明确报错。
3. `download` 点击 `#not-download`，保存到 `browser-smoke/should-not-exist.txt`，timeout=1，预期超时报错；再用 `fs.read` 确认目标文件不存在。
4. `record_start` 保存到 `browser-smoke/interrupted.webm`，随后立即使用 `close_tab` 关闭正在录制的标签页。再调用 `record_stop`，预期返回 `no recording in progress`，不能保持僵尸录屏状态。
5. 调用 `list_tabs`，确认刚创建的标签页已经消失。

最后输出包含每项预期、实际错误和通过状态的汇总表。预期错误必须算通过；任何资源残留算失败。
