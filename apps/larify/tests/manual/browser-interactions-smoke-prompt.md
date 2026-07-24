# browser 元素交互冒烟测试 Prompt

## PROMPT

你正在测试 `browser` 的元素查询与交互工具。先用 `fs.write` 创建一个稳定的本地 fixture：`browser-smoke/interactions.html`，再用 `create_tab` 打开它。

fixture 必须包含：

- 文本输入框 `#name`，初值 `old`。
- 复选框 `#agree`。
- 下拉框 `#color`，选项值 `red`、`blue`。
- 按钮 `#submit`，点击后把 `#status` 文本改为 `submitted`。
- 隐藏元素 `#delayed`，页面加载约 500ms 后显示并写入 `ready`。
- 可滚动容器 `#scroller` 和底部元素 `#bottom`。
- 可拖动元素 `#drag-source` 与目标 `#drop-target`，成功放下后目标文本变为 `dropped`。
- 文件输入框 `#file`，change 后把文件名写入 `#file-name`。
- 下载链接 `#download`，使用 data URL 下载 `fixture.txt`。

必须真实调用工具。每一步先写预期，再写实际和 ✅/❌。

### 1. snapshot 与 query_element

调用 `snapshot` 获取 refs。随后对合适元素测试 `query_element` 的：

- `text`
- `html`
- `value`
- `box`
- `visible`
- `enabled`
- `checked`
- `attr`（读取 `id`）
- `styles`（读取 `display`、`color`）

预期各返回值与 fixture 一致。

### 2. 输入与选择

- `fill` 把 `#name` 改为 `Alice`，再 query value 验证。
- `type` 以 `clear=true` 输入 `Bob`，再验证。
- 对输入框 `element_action` focus，然后 `press` 使用 `Control+A`，再输入 `Carol` 并验证。
- `element_action` check 和 uncheck `#agree`，每次 query checked 验证。
- `select` 选择 `blue`，query value 验证。

### 3. 点击、滚动、拖动

- `click` 点击 `#submit`，预期 `#status` 为 `submitted`。
- 对按钮依次测试 `hover`、`highlight`、`dblclick`，预期无错误。
- `scroll` 滚动 `#scroller`，再对 `#bottom` 执行 `scroll_into_view`。
- `drag` 从 `#drag-source` 到 `#drop-target`，预期目标文本为 `dropped`。

### 4. wait_for

重新加载页面后立即 `wait_for #delayed`，state=`visible`、timeout=5。

预期成功，随后读取文本为 `ready`。再等待 `#does-not-exist`、timeout=1，预期超时报错。

### 5. 上传与下载

1. 用 `fs.write` 创建 `browser-smoke/upload.txt`，内容为 `upload-ok`。
2. `upload` 到 `#file`，预期 `#file-name` 显示 `upload.txt`。
3. `download` 点击 `#download`，保存到 `browser-smoke/downloaded.txt`。
4. 用 `fs.read` 验证文件内容。

最后使用 `close_tab` 关闭测试标签，输出汇总表；任何失败都附真实返回。
