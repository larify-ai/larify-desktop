import type { Node } from './graph'

export type WorkerCommand =
  | { type: 'open'; cwd: string }
  | { type: 'search'; cwd: string; query: string; limit?: number }
  | { type: 'duplicateName'; cwd: string; file: string; name: string }
  | { type: 'close'; cwd: string }
  | { type: 'dispose' }

export type WorkerRequest = WorkerCommand & { id: number }

export interface WorkerResponse {
  id: number
  result?: Node[] | boolean
  error?: string
}
