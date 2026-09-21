import type { ModelMessage } from 'ai'

/**
 * 在发请求前预估「本次将发的 `messages`」的输入 token 数（供上下文守门用）。
 *
 * 一行足矣：JSON 序列化长度 ÷ 每 token 平均字符数。DeepSeek 实测约 2.5–3.3 字符/token，
 * 取偏小的除数使估算**偏大**——守门只需「保守地早触发」，宁可早，不可漏（漏=直接 400 报错）。
 *
 * 为什么不用分词器：DeepSeek 无 JS 分词器；OpenAI 系（`gpt-tokenizer`）对 DeepSeek **高估 20%–44%**；
 * 社区唯一的 JS 原生 DeepSeek 分词器（`@deepseek-kit/tokenizer`）也高估 12.8% 且**慢约 120×（7.5s）**，
 * 而守门每个 step 都要评估。零依赖的字符长度估算零成本、且方向偏保守。
 * 详见 [DeepSeek token 计数与「预估输入」估算函数](file:///C:/Users/hylnb/.larify/memory/larify-desktop/deepseek-token-estimation.md)。
 *
 * 实测（本机 145 会话）：与「按字符成分加权」的精细式相比，本式**偏大 7.7%（中位）**、
 * 触发判定 142/145 一致、3 处不一致均为本式**多触发**（更安全）。
 */
const CHARS_PER_TOKEN = 2.5

export function estimateTokens(messages: ModelMessage[]): number {
  return Math.ceil(JSON.stringify(messages).length / CHARS_PER_TOKEN)
}
