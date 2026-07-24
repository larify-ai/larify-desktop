# browser 标签页与读取冒烟测试 Prompt

## PROMPT

你正在测试 `browser` 的标签页、导航与页面读取工具。必须真实调用工具。

规则：

- 每一步先说明“预期”，再调用工具，最后报告“实际”和 ✅/❌。
- 保存本测试新建标签页的真实 `id`，后续始终使用这些 id。
- 不关闭测试开始前已经存在的标签页。
- 清理时只关闭本测试显式创建的标签页。不要关闭系统自动创建的空白标签页。

### 1. 基线和创建

1. 调用 `list_tabs`，记录基线。
2. 调用 `create_tab` 打开 `https://example.com/`。

预期：返回正整数 id，URL 为 `https://example.com/`，标题为 `Example Domain`。

3. 再次调用 `list_tabs`。

预期：相对基线新增刚创建的标签页。

### 2. 读取

1. 对该标签调用 `snapshot`，设置 `interactive=false`、`includeUrls=true`。

   预期：树中包含 `Example Domain` 和链接 URL。

2. 再调用 `snapshot`，设置 `interactive=true`、`compact=true`。

   预期：至少包含可交互链接及其 ref。

3. 调用 `read_page`。

   预期：返回标题 `Example Domain`；Markdown 正文包含
   `This domain is for use in documentation examples` 和 `Learn more` 链接。
   不要求正文再次包含标题文字 `Example Domain`。

### 3. 导航历史

1. `navigate` goto `https://www.iana.org/help/example-domains`。
2. `navigate` back。
3. `navigate` forward。
4. `navigate` reload。

每一步预期都成功，并核对返回状态的 URL 与动作一致。

### 4. 本地文件

使用 `fs.write` 在当前会话工作目录下创建 `browser-smoke/local.html`，内容包含标题
`Larify Local Fixture` 和正文 `local-file-ok`。然后使用 `create_tab` 打开该相对路径，并保存返回的真实 id。

预期：本地文件可以打开，`read_page` 能读到标题和正文。

### 5. 错误和清理

1. 对 id `999999` 调用 `read_page`。

   预期：返回 not found 错误。

2. 使用 `close_tab` 关闭本测试显式创建的全部标签页。
3. 再次调用 `list_tabs`。

   预期：

   - 本测试显式创建的所有 id 均已不存在。
   - 测试开始前已有的标签页仍然存在。
   - 如果 Browser 工作台可见，系统可能保留一个 URL 和标题均为空的自动空白标签页；这是允许的，不要继续关闭它，也不要求最终列表严格等于初始基线。

4. 再次关闭本测试已关闭的任意一个 id。

   预期：返回 not found 错误。

最后输出汇总表及通过数。若出现系统自动空白标签页，应单独记录，但不计为失败。
