import type { Node } from './graph'
import type { ContextDocument } from './document'

export type WorkerCommand =
  | { type: 'open'; cwd: string }
  | { type: 'search'; cwd: string; query: string; vector?: number[]; limit?: number }
  | { type: 'pending-embedding'; cwd: string }
  | {
      type: 'set-embeddings'
      cwd: string
      uri: string
      hash: string
      vectors: number[][]
    }
  | { type: 'duplicateName'; cwd: string; file: string; name: string }
  | { type: 'close'; cwd: string }
  | { type: 'dispose' }

export type WorkerRequest = WorkerCommand & { id: number }

export interface WorkerResponse {
  id: number
  result?: Node[] | ContextDocument | boolean
  error?: string
}

export interface WorkerNotification {
  type: 'changed'
  cwd: string
}
