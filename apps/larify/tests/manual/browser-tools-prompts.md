# browser 工具手工测试 Prompt

浏览器工具按能力拆成 5 组。每次只把一个 prompt 发给 Larify agent，避免一次调用过多工具导致漏测。

| 组 | 文件 | 覆盖工具 |
| --- | --- | --- |
| 1 | `browser-search-fetch-smoke-prompt.md` | `web_search`、`web_fetch` |
| 2 | `browser-tabs-read-smoke-prompt.md` | `create_tab`、`list_tabs`、`navigate`、`snapshot`、`read_page`、`close_tab` |
| 3 | `browser-interactions-smoke-prompt.md` | `query_element`、`click`、`element_action`、`drag`、`upload`、`download`、`fill`、`type`、`press`、`select`、`scroll`、`wait_for` |
| 4 | `browser-capture-input-smoke-prompt.md` | `screenshot`、`pdf`、`record_start`、`record_stop`、`record_restart`、键盘和鼠标工具 |
| 5 | `browser-debug-smoke-prompt.md` | `eval_js`、`cdp_call`、`cdp_events`、`console`、`errors` |

每组都要求 agent：

- 调用真实工具，不用文字模拟。
- 每一步先说明预期，再报告实际结果。
- 保留测试过程中创建的输出文件，方便人工检查。
- 最后输出通过/失败表和失败证据。

