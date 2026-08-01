import type { Worker } from 'node:worker_threads'
import createWorker from './worker?nodeWorker'
import type { EmbeddingWorkerCommand, EmbeddingWorkerResponse } from './worker-protocol'
import type { MarkdownEmbeddingDocument } from './chunker'

type EmbeddingResult = number[] | number[][] | undefined

export class EmbeddingWorker {
  private worker?: Worker
  private nextId = 0
  private readonly pending = new Map<
    number,
    {
      resolve: (value: EmbeddingResult) => void
      reject: (error: Error) => void
    }
  >()

  async embedQuery(query: string): Promise<number[]> {
    return (await this.send({ type: 'embed-query', query })) as number[]
  }

  async embedMarkdown(document: MarkdownEmbeddingDocument): Promise<number[][]> {
    return (await this.send({ type: 'embed-markdown', document })) as number[][]
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    this.worker = undefined
    this.fail(new Error('Embedding worker disposed.'))
    await worker.terminate()
  }

  private send(request: EmbeddingWorkerCommand): Promise<EmbeddingResult> {
    const worker = this.worker ?? this.start()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        worker.postMessage({ ...request, id })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  private start(): Worker {
    const worker = createWorker({})
    worker.on('message', (response: EmbeddingWorkerResponse) => {
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if ('error' in response) pending.reject(new Error(response.error))
      else pending.resolve(response.result)
    })
    worker.on('error', (error) => {
      if (this.worker !== worker) return
      this.worker = undefined
      this.fail(error)
    })
    worker.on('exit', (code) => {
      if (this.worker !== worker) return
      this.worker = undefined
      if (this.pending.size) {
        this.fail(new Error(`Embedding worker exited with code ${code}.`))
      }
    })
    this.worker = worker
    return worker
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
