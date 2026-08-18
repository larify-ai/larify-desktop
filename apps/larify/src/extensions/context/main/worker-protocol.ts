import type { Node } from './graph'
import type { ContextDocument } from './document'

export type WorkerCommand =
  | { type: 'open' }
  | { type: 'search'; query: string; vector?: number[]; limit?: number }
  | { type: 'pending-embedding' }
  | {
      type: 'set-embeddings'
      uri: string
      hash: string
      vectors: number[][]
    }
  | { type: 'duplicateName'; file: string; name: string }
  | { type: 'dispose' }

export type WorkerRequest = WorkerCommand & { id: number }

export interface WorkerResponse {
  id: number
  result?: Node[] | ContextDocument | boolean
  error?: string
}

export interface WorkerNotification {
  type: 'changed'
}
