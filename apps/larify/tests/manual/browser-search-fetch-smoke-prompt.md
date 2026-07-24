# browser 搜索与抓取冒烟测试 Prompt

## PROMPT

你正在测试 `browser` 的网络搜索与抓取工具。必须真实调用工具，不要用已有知识代替结果。

规则：

- 每一步先写“预期”，调用工具后再写“实际”和 ✅/❌。
- 后续步骤必须使用前一步真实返回的数据，不得编造 URL。
- 不要创建可见浏览器标签页；这组工具应使用后台临时页。
- 最后输出步骤、预期、实际、结果表。

### 1. web_search 基本搜索

调用 `web_search`，query 为 `ESP-IDF getting started official documentation`。

预期：

- 返回非空 `results`。
- 每项有非空 `title` 和 `url`，大部分结果有 `snippet`。
- 至少一个结果来自 `docs.espressif.com`；若没有，记为失败并保留实际结果。
- 若返回 `nextPageUrl`，它应是可用的绝对 URL；URL 中的百分号编码不算乱码。

### 2. web_fetch 读取搜索结果

从第 1 步选择一个 `docs.espressif.com` 结果，把它的原始 `url` 传给 `web_fetch`。

预期：

- 返回非空 `title` 和 Markdown `content`，或因内容过长返回 `path`、`bytes`、`preview`。
- 内容能看到 ESP-IDF 入门、安装或项目创建相关正文，而不是只有导航栏。

### 3. 下一页

仅当第 1 步返回 `nextPageUrl` 时，调用 `web_search`，把它原样作为 `pageUrl`。

预期：

- 返回另一页非空结果。
- 与第 1 页比较 URL；报告重复数量，但不要擅自把少量重复判定为工具失败。

如果没有 `nextPageUrl`，明确记为“跳过”，不要伪造。

### 4. 自定义选择器

再次搜索同一 query，显式传入当前 Bing 默认选择器：

```json
{
  "result": "#b_results > li.b_algo",
  "title": "h2",
  "link": "h2 a[href], a[href]:has(> h2)",
  "snippet": ".b_caption p, p.b_algoSlug, p.b_lineclamp2, p.b_lineclamp3",
  "nextPage": "a.sb_pagN[href]"
}
```

预期返回非空结果，结构与第 1 步一致。

### 5. 错误输入

分别验证：

- `web_search` 同时传 `query` 和 `pageUrl`：预期参数校验报错。
- `web_search` 两者都不传：预期参数校验报错。
- `web_fetch` 传明显不存在的本地路径：预期返回错误。

最后汇总通过数、失败数、跳过数，并贴出所有失败步骤的真实工具返回。

