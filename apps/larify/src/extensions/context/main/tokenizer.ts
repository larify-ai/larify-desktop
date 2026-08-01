import { cut_for_search } from 'jieba-wasm'

export function tokenize(text: string): string {
  return terms(text).join(' ')
}

export function searchQuery(text: string): string {
  return terms(text)
    .map((token) => JSON.stringify(token))
    .join(' OR ')
}

function terms(text: string): string[] {
  return cut_for_search(text).filter((token) => token.trim())
}
