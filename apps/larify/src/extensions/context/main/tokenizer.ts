import { cut_for_search } from 'jieba-wasm'

export function tokenize(text: string): string {
  return cut_for_search(text).join(' ')
}

export function searchQuery(text: string): string {
  const query = tokenize(text)
  return query ? `"${query.replaceAll('"', '""')}"` : ''
}
