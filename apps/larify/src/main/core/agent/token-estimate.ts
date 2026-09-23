import type { ModelMessage } from 'ai'

/**
 * 在发请求前预估「本次将发的 `messages`」的输入 token 数（供上下文守门用）。
 *
 * ## 做法：`JSON.stringify` + replacer 把图片块折叠成短占位
 *
 * 旧式一行 `ceil(JSON.stringify(messages).length / 2.5)` 有一处**致命偏差**：图片不以字符
 * 长度计费（按**像素面积**，每图上限 1024 token），却被当成一大段 base64 计入 ⇒ 一张 1.5 MB
 * PNG 估成 ≈ +82 万 token（真实仅 ≈1024，**高估约 3 个数量级**）⇒「上下文还很充裕却触发上下文
 * 重置」。真实事故：会话 `55b61dbe` 正文仅 ≈2.8 万 estTokens，两张 ~1.5 MB PNG 把估算顶到
 * ≈168 万 ⇒ 误触发。
 * 详见 [守门被图片误触发](file:///C:/Users/hylnb/.larify/memory/larify-desktop/rollover-false-trigger-on-images.md)。
 *
 * ⇒ 只需在 replacer 里把图片/file 块**换成固定占位**，其余照旧走 `JSON.stringify`。认块的依据是
 * **`mediaType` 是字符串**（图片/file 块的充分标志），比 `type === 'file'` 更准——工具 `input`
 * 里出现同名的 `{type:'file'}` 字段时不会被误判。
 *
 * ## 为什么图片只需一条判定
 *
 * 图片进入 `ModelMessage` 实际**只有 `fs_read_image` 一条路**：`read-image.ts` 的
 * `toModelOutput` 返回 `{type:'content', value:[{type:'file', mediaType, data}]}`，再被
 * `tool-images.ts#promoteToolImages` 抬成独立 user 块。
 * （用户附件看似也是一条，但 `messages.ts#replaceFilesWithPaths` 在送模型前会把 `file` part
 * **换成一行 `Attached paths:` 文本** ⇒ 图片本身根本不进模型。）
 * AI SDK 在 `convertToLanguageModelMessage` 里还会把 deprecated 的 `image` 与
 * `file-data`/`image-data`/`media` 一律归一成带 `mediaType` 的 file 块 ⇒ 一样被本函数折叠。
 * 详见 [图片进入模型上下文的真实形态](file:///C:/Users/hylnb/.larify/memory/larify-desktop/image-shape-in-model-messages.md)。
 *
 * ## 为什么可以继续用 `JSON.stringify`（含除数取值依据）
 *
 * `JSON.stringify` **原生处理循环引用与深嵌套**，故本函数不需要任何遍历/深度保护；它多算的
 * 「结构脚手架」（键名、括号、引号）**恰恰是让估算贴近服务端的原因**——服务端 `usage.inputTokens`
 * 同样包含消息框架、角色标记、工具 schema 等结构性开销，而「只数字符」的口径会漏掉这一块。
 *
 * **除数 2.5 是实测校准值**：用真实会话 `f2b9ecac`（服务端实测 `inputTokens = 1,047,867`，
 * 唯一留存真值的样本）对照，本口径下各除数的偏差为
 * `2.5 ⇒ +3.5%` / `2.588 ⇒ 0%` / `2.64 ⇒ −2.0%` / `3.0 ⇒ −13.7%`。
 * 取 2.5 使估算**略微偏大**（守门「宁可早、不可漏」：漏 = 直接 400 报错，早 = 只是多提示一次）。
 * 详见 [估算函数除数校准](file:///C:/Users/hylnb/.larify/memory/larify-desktop/token-estimate-divisor-calibration.md)。
 *
 * ## 为什么不用分词器 / 为什么不用 AI SDK 的 API
 *
 * **AI SDK（`ai@7`）不提供任何 token 计数 API**：全量导出里没有 `countTokens`/`estimateTokens`/
 * `tokenCount`（只有 `usage.inputTokens`——服务端在**该 step 返回后**才有的实测值，正是守门
 * **不能**用的量：step#0 无值、step#n 滞后一步；见 [守门读错了量](file:///C:/Users/hylnb/.larify/memory/larify-desktop/context-rollover-reads-wrong-quantity.md)）。
 * 也**不用第三方分词器**：DeepSeek 无 JS 分词器；OpenAI 系（`gpt-tokenizer`）对 DeepSeek
 * **高估 20%–44%**；社区唯一的 JS 原生 DeepSeek 分词器（`@deepseek-kit/tokenizer`）也高估 12.8%
 * 且**慢约 120×（7.5s）**，而守门每个 step 都要评估。零依赖的字符长度估算零成本、且方向偏保守。
 * 详见 [DeepSeek token 计数与「预估输入」估算函数](file:///C:/Users/hylnb/.larify/memory/larify-desktop/deepseek-token-estimation.md)。
 *
 * ## 实现约束（务必保持）
 *
 * **零运行时依赖、不 import 任何 provider 类型**：本项目曾出现「AI SDK 类型在运行时丢失 ⇒
 * 加载即崩」的先例，故本文件只用纯值与 `JSON.stringify` 的 replacer，引类型仅 `import type`。
 */
const CHARS_PER_TOKEN = 2.5

/** 图片/file 块的占位符：折叠后不再按字符计费（其成本已由除数吸收/忽略）。 */
const IMAGE_PLACEHOLDER = '[image]'

/** 是否是「图片/file 块」：带 `mediaType` 字符串（`FilePart` 的充分标志，且不会误伤同名 `type` 字段）。 */
function isMediaBlock(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { mediaType?: unknown }).mediaType === 'string'
  )
}

export function estimateTokens(messages: ModelMessage[]): number {
  const json = JSON.stringify(messages, (_key, value: unknown) =>
    isMediaBlock(value) ? IMAGE_PLACEHOLDER : value
  )

  return Math.ceil(json.length / CHARS_PER_TOKEN)
}
