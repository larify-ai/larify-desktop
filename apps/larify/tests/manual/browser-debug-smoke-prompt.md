# browser 调试工具冒烟测试 Prompt

## PROMPT

你正在测试 `browser` 的 JavaScript、Console、页面错误和 CDP 工具。

先用 `fs.write` 创建 `browser-smoke/debug.html`。页面加载时执行：

```html
<script>
console.log('larify-log', { value: 42 })
console.warn('larify-warning')
setTimeout(() => { throw new Error('larify-test-error') }, 200)
</script>
```

用 `create_tab` 打开它并保存 id。每一步先写预期，调用后报告实际和 ✅/❌。

### 1. eval_js

- 执行 `() => ({ title: document.title, href: location.href })`。
- 执行 `() => Array.from(document.querySelectorAll('*')).length`。

预期返回可解析结果，标题、URL 和元素数量合理。

### 2. console 与 errors

- 调用 `console`，预期能看到 `larify-log` 和 `larify-warning`。
- 调用 `console`，level=`warning`，预期仅返回 warning 级别。
- 等待片刻后调用 `errors`，预期看到 `larify-test-error`。
- 分别以 `clear=true` 读取一次，再读取一次，预期第二次相应 buffer 为空。

### 3. CDP 调用

- `cdp_call` method=`Runtime.enable`。
- `cdp_call` method=`Page.enable`。
- `cdp_call` method=`Runtime.evaluate`，params 为：

```json
{"expression":"document.title","returnByValue":true}
```

预期结果中包含页面标题。

### 4. CDP 事件

启用 Page domain 后执行一次 `navigate` reload，然后调用：

- `cdp_events`，filter=`Page.`

预期返回一个或多个 Page 事件，报告 `count` 和 `dropped`。随后再次 drain，预期已读取事件不会重复出现。

### 5. 错误路径

- `cdp_call` 使用不存在的 method `Larify.DoesNotExist`，预期返回错误。
- `eval_js` 执行 `() => { throw new Error('eval-failure') }`，预期返回错误。
- 对 id `999999` 调用 `console`，预期 not found。

最后使用 `close_tab` 关闭测试标签，输出步骤汇总、通过数、失败数，并附失败的真实结果。
