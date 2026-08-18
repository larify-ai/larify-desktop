import type { Worker } from 'node:worker_threads'
import type { EmbeddingWorker } from '../../embedding/main/worker-client'
import type { ContextDocument } from './document'
import type { Node } from './graph'
import createWorker from './worker?nodeWorker'
import type { WorkerCommand, WorkerNotification, WorkerResponse } from './worker-protocol'

export class ContextWorker {
  private worker?: Worker
  private nextId = 0
  private active = false
  private syncing = false
  private syncRequested = false
  private readonly pending = new Map<
    number,
    {
      resolve: (value: Node[] | ContextDocument | boolean | undefined) => void
      reject: (error: Error) => void
    }
  >()

  constructor(private readonly getEmbeddings?: () => EmbeddingWorker | undefined) {}

  async open(): Promise<void> {
    this.active = true
    await this.send({ type: 'open' })
    this.updateEmbeddings()
  }

  async search(query: string, limit?: number): Promise<Node[]> {
    if (!query.trim() || (limit !== undefined && limit <= 0)) return []
    this.active = true
    const embeddings = this.getEmbeddings?.()
    if (embeddings) {
      this.updateEmbeddings()
      try {
        const vector = await embeddings.embedQuery(query)
        return ((await this.send({ type: 'search', query, vector, limit })) ?? []) as Node[]
      } catch (error) {
        console.error('[context:embedding]', error)
      }
    }
    return ((await this.send({ type: 'search', query, limit })) ?? []) as Node[]
  }

  async duplicateName(file: string, name: string): Promise<boolean> {
    return Boolean(await this.send({ type: 'duplicateName', file, name }))
  }

  async dispose(): Promise<void> {
    this.active = false
    const worker = this.worker
    if (!worker) return
    try {
      await this.send({ type: 'dispose' })
    } finally {
      try {
        await worker.terminate()
      } finally {
        if (this.worker === worker) this.worker = undefined
      }
    }
  }

  private async syncEmbeddings(embeddings: EmbeddingWorker): Promise<void> {
    while (true) {
      if (!this.active) return
      const pending = (await this.send({ type: 'pending-embedding' })) as
        ContextDocument | undefined
      if (!pending) return
      const { node, content, hash } = pending
      const { name, description, uri } = node
      if (!this.active) return
      const vectors = await embeddings.embedMarkdown({ name, description, content })
      if (!this.active) return
      if (!vectors.length) throw new Error(`No embeddings generated for ${uri}.`)
      await this.send({ type: 'set-embeddings', uri, hash, vectors })
    }
  }

  private updateEmbeddings(): void {
    const embeddings = this.getEmbeddings?.()
    if (!embeddings || !this.active) return
    if (this.syncing) {
      this.syncRequested = true
      return
    }
    this.syncing = true
    this.syncRequested = false
    void this.syncEmbeddings(embeddings)
      .catch((error) => console.error('[context:embedding]', error))
      .finally(() => {
        this.syncing = false
        if (this.syncRequested) this.updateEmbeddings()
      })
  }

  private send(request: WorkerCommand): Promise<Node[] | ContextDocument | boolean | undefined> {
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
    worker.on('message', (response: WorkerResponse | WorkerNotification) => {
      if ('type' in response) {
        this.updateEmbeddings()
        return
      }
      const pending = this.pending.get(response.id)
      if (!pending) return
      this.pending.delete(response.id)
      if (response.error) pending.reject(new Error(response.error))
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
      if (this.pending.size) this.fail(new Error(`Context worker exited with code ${code}.`))
    })
    this.worker = worker
    return worker
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
