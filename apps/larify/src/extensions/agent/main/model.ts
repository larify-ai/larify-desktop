import { createDeepSeek } from "@ai-sdk/deepseek"
import type { LanguageModel } from "ai"

export type ModelId = "deepseek-v4-flash" | "deepseek-v4-pro"

const deepseek = createDeepSeek({
  baseURL: "https://api.deepseek.com",
  apiKey: "sk-51d1b62d722148e6973c420d5d900faf",
})

export function createModel(id: ModelId = "deepseek-v4-flash"): LanguageModel {
  return deepseek(id)
}
