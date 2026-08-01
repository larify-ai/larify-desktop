import type { MarkdownEmbeddingDocument } from './chunker'

export type EmbeddingWorkerCommand =
  | { type: 'embed-query'; query: string }
  | { type: 'embed-markdown'; document: MarkdownEmbeddingDocument }

export type EmbeddingWorkerRequest = EmbeddingWorkerCommand & { id: number }

export type EmbeddingWorkerResponse =
  { id: number; result: number[] | number[][] } | { id: number; error: string }
